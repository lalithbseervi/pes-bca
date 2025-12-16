// Exponential backoff rate limiting for file downloads

import { createLogger } from './logger.js';

const log = createLogger('RateLimit');

const RATE_LIMIT_WINDOW = 600000; // 10 minutes in milliseconds
const DEFAULT_MAX_REQUESTS_PER_WINDOW = 40; // Default: 10 requests per 10 minutes per user
const PENALTY_BASE_DURATION = 120000; // 2 minutes base penalty
const PENALTY_MULTIPLIER = 3; // 3x increase per offense (2min, 6min, 18min, 54min)
const MAX_PENALTY_DURATION = 21600000; // Max 360 mins (6 hours) penalty

// Get configured rate limit from KV or return default
async function getMaxRequestsPerWindow(env) {
  const configStore = env.CONFIG_KV;
  if (!configStore) return DEFAULT_MAX_REQUESTS_PER_WINDOW;
  try {
    const config = await configStore.get('config:max_requests_per_window');
    if (config) {
      const value = parseInt(config);
      if (value > 0 && value <= 1000) return value; // Sanity check: 1-1000
    }
  } catch (e) {
    log.warn('Failed to get max requests config', e);
  }
  return DEFAULT_MAX_REQUESTS_PER_WINDOW;
}

// In-memory fallback store (used if KV unavailable)
const rateLimitStore = new Map();

// KV key prefix
const KV_KEY_PREFIX = 'rl:'; // rl:<identity>

// Utilities to derive a stable identity for rate-limiting
import { parseCookies } from './cookies.js'
import { verifyJWT } from './sign_jwt.js'

function extractClientIP(request) {
  // Prefer Cloudflare-provided header
  let ip = request.headers.get('CF-Connecting-IP')
  if (!ip) {
    const xff = request.headers.get('X-Forwarded-For') || request.headers.get('x-forwarded-for')
    if (xff) ip = xff.split(',')[0].trim()
  }
  return ip || 'unknown'
}

// Returns a string identity used as the KV key suffix: "usr:<srn>" for authenticated
// users, else "ip:<address>". This avoids punishing multiple users behind one NAT.
export async function deriveRateLimitIdentity(request, env) {
  try {
    const cookies = parseCookies(request.headers.get('cookie'))
    const access = cookies['access_token']
    if (access && env && env.JWT_SECRET) {
      const v = await verifyJWT(access, env.JWT_SECRET)
      if (v.valid && v.payload?.type === 'access' && v.payload?.sub) {
        return `usr:${v.payload.sub}`
      }
    }
  } catch (e) {
    // fall back to IP
  }
  return `ip:${extractClientIP(request)}`
}

async function kvGet(env, ip) {
  if (!env.RATE_LIMIT_KV) return null;
  try {
    const raw = await env.RATE_LIMIT_KV.get(KV_KEY_PREFIX + ip, 'json');
    return raw || null;
  } catch (e) {
    log.warn('KV get failed', e);
    return null;
  }
}

async function kvPut(env, ip, data, ttlSeconds) {
  if (!env.RATE_LIMIT_KV) return;
  try {
    await env.RATE_LIMIT_KV.put(
      KV_KEY_PREFIX + ip,
      JSON.stringify(data),
      ttlSeconds ? { expirationTtl: ttlSeconds } : undefined
    );
  } catch (e) {
    log.warn('KV put failed', e);
  }
}

// Clean up old entries periodically to prevent memory leak
function cleanupExpiredEntries() {
  const now = Date.now();
  for (const [ip, data] of rateLimitStore.entries()) {
    const validRequests = data.requests.filter(time => now - time < RATE_LIMIT_WINDOW);
    const validViolations = data.violations.filter(time => now - time < MAX_PENALTY_DURATION);
    
    if (validRequests.length === 0 && validViolations.length === 0) {
      rateLimitStore.delete(ip);
    } else {
      rateLimitStore.set(ip, { requests: validRequests, violations: validViolations });
    }
  }
}

// Calculate penalty duration based on number of violations
function calculatePenalty(violations) {
  if (violations.length === 0) return 0;
  
  // Exponential backoff: 2min * (3^violations)
  // 1st: 2min, 2nd: 6min, 3rd: 18min, 4th: 54min, capped at 6hr
  const penalty = PENALTY_BASE_DURATION * Math.pow(PENALTY_MULTIPLIER, violations.length);
  return Math.min(penalty, MAX_PENALTY_DURATION);
}

// Check if IP is currently in penalty period
function checkPenaltyPeriod(ip, now) {
  const data = rateLimitStore.get(ip);
  if (!data || data.violations.length === 0) return null;
  
  // Get recent violations (within max penalty window)
  const recentViolations = data.violations.filter(time => now - time < MAX_PENALTY_DURATION);
  if (recentViolations.length === 0) return null;
  
  // Calculate when the most recent violation's penalty expires
  const lastViolation = recentViolations[recentViolations.length - 1];
  const penaltyDuration = calculatePenalty(recentViolations);
  const penaltyEndTime = lastViolation + penaltyDuration;
  
  if (now < penaltyEndTime) {
    return {
      inPenalty: true,
      endsAt: penaltyEndTime,
      violationCount: recentViolations.length,
      remainingMs: penaltyEndTime - now
    };
  }
  
  return null;
}

// Check if request is within rate limit
export async function checkRateLimit(ip, env, { consume = true } = {}) {
  const now = Date.now();
  const MAX_REQUESTS_PER_WINDOW = await getMaxRequestsPerWindow(env);
  
  // Check if IP is in penalty period from previous violations
  const penalty = checkPenaltyPeriod(ip, now);
  if (penalty) {
    const resetAt = new Date(penalty.endsAt);
    const remainingSeconds = Math.ceil(penalty.remainingMs / 1000);
    
    return {
      allowed: false,
      remaining: 0,
      resetAt: resetAt.toISOString(),
      limit: MAX_REQUESTS_PER_WINDOW,
      penaltyActive: true,
      violationCount: penalty.violationCount,
      retryAfter: remainingSeconds
    };
  }
  
  // Get existing data for this IP
  // Load from KV if available, else memory
  let data = await kvGet(env, ip);
  if (!data) {
    data = rateLimitStore.get(ip) || { requests: [], violations: [] };
  }
  
  // Filter out expired requests (older than window)
  const validRequests = data.requests.filter(time => now - time < RATE_LIMIT_WINDOW);
  const validViolations = data.violations.filter(time => now - time < MAX_PENALTY_DURATION);
  
  // Request count logged internally, not to console
  
  // Check if limit would be exceeded by this request
  if (validRequests.length >= MAX_REQUESTS_PER_WINDOW) {
    // Record violation
    validViolations.push(now);
    
    const oldestRequest = validRequests[0];
    const penaltyDuration = calculatePenalty(validViolations);
    const penaltyEndTime = now + penaltyDuration;
    
    // Don't add this request to the count
    const record = { requests: validRequests, violations: validViolations };
    rateLimitStore.set(ip, record);
    await kvPut(env, ip, record, Math.ceil(MAX_PENALTY_DURATION / 1000));
    
  // Rate limit blocking logged internally
    
    return {
      allowed: false,
      remaining: 0,
      resetAt: new Date(penaltyEndTime).toISOString(),
      limit: MAX_REQUESTS_PER_WINDOW,
      penaltyActive: true,
      violationCount: validViolations.length,
      retryAfter: Math.ceil(penaltyDuration / 1000)
    };
  }
  
  // Add current request timestamp
  if (consume) {
    validRequests.push(now);
  }
  const record = { requests: validRequests, violations: validViolations };
  rateLimitStore.set(ip, record);
  await kvPut(env, ip, record, Math.ceil(MAX_PENALTY_DURATION / 1000));
    
  // Cleanup periodically (every 100 requests)
  if (Math.random() < 0.01) {
    cleanupExpiredEntries();
  }
  
  return {
    allowed: true,
    remaining: MAX_REQUESTS_PER_WINDOW - validRequests.length,
    resetAt: new Date(now + RATE_LIMIT_WINDOW).toISOString(),
    limit: MAX_REQUESTS_PER_WINDOW,
    penaltyActive: false,
    violationCount: validViolations.length
  };
}

// Create rate limit error response
export function rateLimitResponse(limitInfo) {
  const retryAfter = limitInfo.retryAfter || 60;
  let message = 'Too many requests. Please try again later.';
  
  if (limitInfo.penaltyActive && limitInfo.violationCount > 1) {
    const minutes = Math.ceil(retryAfter / 60);
    message = `Multiple rate limit violations detected. Penalty timeout: ${minutes} minute${minutes !== 1 ? 's' : ''}. (Violation #${limitInfo.violationCount})`;
  }
  
  return new Response(JSON.stringify({
    error: 'Rate limit exceeded',
    message: message,
    limit: limitInfo.limit,
    remaining: limitInfo.remaining,
    resetAt: limitInfo.resetAt,
    penaltyActive: limitInfo.penaltyActive,
    violationCount: limitInfo.violationCount,
    retryAfter: retryAfter
  }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': retryAfter.toString(),
      'X-RateLimit-Limit': limitInfo.limit.toString(),
      'X-RateLimit-Remaining': limitInfo.remaining.toString(),
      'X-RateLimit-Reset': limitInfo.resetAt,
      'X-RateLimit-Violation-Count': (limitInfo.violationCount || 0).toString()
    }
  });
}
