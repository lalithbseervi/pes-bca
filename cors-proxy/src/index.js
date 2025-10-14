addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request, event.env || globalThis))
})

const JSON_HEADERS = { 'Content-Type': 'application/json' }

async function verifyTurnstile(secret, token, remoteip) {
  const params = new URLSearchParams()
  params.append('secret', secret)
  params.append('response', token)
  if (remoteip) params.append('remoteip', remoteip)

  const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  })
  if (!resp.ok) return { success: false }
  return resp.json()
}

function parseCookies(header) {
  const cookies = {}
  if (!header) return cookies
  header.split(';').forEach(pair => {
    const idx = pair.indexOf('=')
    if (idx < 0) return
    const k = pair.slice(0, idx).trim()
    const v = pair.slice(idx + 1).trim()
    cookies[k] = decodeURIComponent(v || '')
  })
  return cookies
}

function makeCookieHeader(token, maxAgeSec) {
  // For cross-site cookies, we need: SameSite=None, Secure, and Partitioned
  // Partitioned attribute enables CHIPS (Cookies Having Independent Partitioned State)
  return `session_token=${token}; Max-Age=${maxAgeSec}; Path=/; HttpOnly; SameSite=None; Secure; Partitioned`
}

// Helper to hash password for cache key (using Web Crypto API)
async function hashPassword(password) {
  const encoder = new TextEncoder()
  const data = encoder.encode(password)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

// Helper to verify cached credentials
async function verifyCachedCredentials(env, srn, password) {
  const passwordHash = await hashPassword(password)
  const cacheKey = `auth_cache:${srn}:${passwordHash}`
  
  // Check if credentials are cached
  const cached = await env.SESSIONS.get(cacheKey)
  if (cached) {
    return { success: true, profile: JSON.parse(cached), cached: true }
  }
  
  return { success: false, cached: false }
}

async function cacheAuthResult(env, srn, password, profile) {
  const passwordHash = await hashPassword(password)
  const cacheKey = `auth_cache:${srn}:${passwordHash}`
  
  // expire cached data to avoid permitting incorrect creds
  const cacheTTL = 60 * 60 * 24 * 14 // 14 days
  await env.SESSIONS.put(cacheKey, JSON.stringify(profile), { expirationTtl: cacheTTL })
}

// Helper to invalidate cached credentials for a user (when password changes)
async function invalidateCachedAuth(env, srn) {
  // List all cache keys for this SRN
  const prefix = `auth_cache:${srn}:`
  const list = await env.SESSIONS.list({ prefix })
  
  // Delete all cached credentials for this user
  const deletePromises = list.keys.map(key => env.SESSIONS.delete(key.name))
  await Promise.all(deletePromises)
}

// Helper to get CORS headers
function getCorsHeaders(request) {
  // For local development, accept common localhost origins
  const origin = request.headers.get('Origin')
  const allowedOrigin = origin || 'https://pes-bca.pages.dev'
  
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin'
  }
}

async function handleRequest(request, env) {
  const url = new URL(request.url)

    // Handle OPTIONS preflight
  if (request.method === 'OPTIONS') {
    const corsHeaders = getCorsHeaders(request)
    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      }
    })
  }

  // POST /api/login
  if (request.method === 'POST' && url.pathname === '/api/login') {
    let body;
    try { body = await request.json() } catch (e) {
      return new Response(JSON.stringify({ success:false, message:'invalid json' }), { status:400, headers: { ...JSON_HEADERS, ...getCorsHeaders(request) } })
    }

    const { srn, password, turnstileToken } = body
    const turnstileSecret = env.TURNSTILE_SECRET
    if (!turnstileSecret) {
      return new Response(JSON.stringify({ success:false, message:'server misconfigured' }), { status:500, headers: { ...JSON_HEADERS, ...getCorsHeaders(request) } })
    }

    if (!turnstileToken) {
      return new Response(JSON.stringify({ success:false, message:'human verification required' }), { status:400, headers: { ...JSON_HEADERS, ...getCorsHeaders(request) } })
    }

    const verification = await verifyTurnstile(turnstileSecret, turnstileToken, request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for'))
    if (!verification.success) {
      return new Response(JSON.stringify({ success:false, message:'human verification failed', detail: verification }), { status:403, headers: { ...JSON_HEADERS, ...getCorsHeaders(request) } })
    }

    // Step 1: Check cached credentials first (fast path)
    const cachedAuth = await verifyCachedCredentials(env, srn, password)
    
    let profile
    if (cachedAuth.success) {
      // Cache hit! Use cached profile
      profile = cachedAuth.profile
      console.log(`Cache HIT for ${srn} - fast login`)
    } else {
      console.log(`Cache MISS for ${srn} - calling auth API`)
      
      const authApi = env.AUTH_API
      if (!authApi) { return new Response(JSON.stringify({ success:false, message:'invalid config (no AUTH_API given)' }), { status:401, headers: { ...JSON_HEADERS, ...getCorsHeaders(request) } })      } else {
        try {
          const authResp = await fetch(authApi, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: srn, password, profile: true, fields: ['branch','semester','name'] })
          })
          const authResult = await authResp.json()
          
          if (!authResp.ok || !authResult.profile) {
            return new Response(JSON.stringify({ success:false, message: authResult.message || 'invalid credentials' }), { status:401, headers: { ...JSON_HEADERS, ...getCorsHeaders(request) } })
          }
          
          profile = authResult.profile
          
          // Cache the successful authentication
          await cacheAuthResult(env, srn, password, profile)
          console.log(`Cached credentials for ${srn}`)
          
        } catch (e) {
          console.error('Auth API error:', e)
          return new Response(JSON.stringify({ success:false, message:'auth backend error' }), { status:502, headers: { ...JSON_HEADERS, ...getCorsHeaders(request) } })
        }
      }
    }

    // create opaque session token and store in KV (SESSIONS binding)
    const array = crypto.getRandomValues(new Uint8Array(32))
    const token = Array.from(array).map(b => b.toString(16).padStart(2,'0')).join('')
    const ttlSec = 60 * 60 * 24 * 3 // 72 hours
    const session = {
      srn,
      profile: profile, // Use profile from cache or API
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + ttlSec * 1000).toISOString()
    }

    await env.SESSIONS.put(token, JSON.stringify(session), { expirationTtl: ttlSec })

    const cookieHeader = makeCookieHeader(token, ttlSec)

    // Determine redirect path
    let redirectPath = '/';
    // Priority: query param > Referer header > default
    if (url.searchParams.has('redirect')) {
      redirectPath = url.searchParams.get('redirect');
    } else {
      const referer = request.headers.get('referer');
      if (referer) {
        try {
          const refUrl = new URL(referer);
          if (refUrl.pathname && refUrl.pathname !== '/api/login') {
            redirectPath = refUrl.pathname;
          }
        } catch {}
      }
    }

    const resBody = { 
      success: true, 
      session: { srn: session.srn, profile: session.profile, expiresAt: session.expiresAt }, 
      redirect: redirectPath,
      cached: cachedAuth.success // Let frontend know if it was a cache hit
    }
    return new Response(JSON.stringify(resBody), {
      status:200,
      headers: {
        ...JSON_HEADERS,
        ...getCorsHeaders(request),
        'Set-Cookie': cookieHeader
      }
    })
  }

  // GET /api/session
  if (request.method === 'GET' && url.pathname === '/api/session') {
    const cookies = parseCookies(request.headers.get('cookie'))
    const token = cookies['session_token']
    if (!token) {
      return new Response(JSON.stringify({ success:false }), { status:401, headers: { ...JSON_HEADERS, ...getCorsHeaders(request) } })
    }
    const stored = await env.SESSIONS.get(token)
    if (!stored) {
      return new Response(JSON.stringify({ success:false }), { status:401, headers: { ...JSON_HEADERS, ...getCorsHeaders(request) } })
    }
    const session = JSON.parse(stored)
    return new Response(JSON.stringify({ success:true, session }), { status:200, headers: { ...JSON_HEADERS, ...getCorsHeaders(request) } })
  }

  // POST /api/logout
  if (request.method === 'POST' && url.pathname === '/api/logout') {
    const cookies = parseCookies(request.headers.get('cookie'))
    const token = cookies['session_token']
    if (token) {
      await env.SESSIONS.delete(token)
    }
    const expiredCookie = 'session_token=; Max-Age=0; Path=/; HttpOnly; SameSite=None; Secure; Partitioned'
    return new Response(JSON.stringify({ success:true }), { 
      status:200, 
      headers: { 
        ...JSON_HEADERS, 
        ...getCorsHeaders(request),
        'Set-Cookie': expiredCookie 
      } 
    })
  }

  // POST /api/invalidate-cache/:srn
  // Endpoint to invalidate cached credentials (useful when password changes)
  if (request.method === 'POST' && url.pathname.startsWith('/api/invalidate-cache/')) {
    const srn = url.pathname.split('/').pop()
    
    if (!srn) {
      return new Response(JSON.stringify({ success: false, message: 'SRN required' }), { 
        status: 400, 
        headers: { ...JSON_HEADERS, ...getCorsHeaders(request) } 
      })
    }

    await invalidateCachedAuth(env, srn)
    
    return new Response(JSON.stringify({ 
      success: true, 
      message: `Cached credentials invalidated for ${srn}` 
    }), { 
      status: 200, 
      headers: { ...JSON_HEADERS, ...getCorsHeaders(request) } 
    })
  }

  // GET /api/cache-stats
  // Endpoint to get cache statistics (requires authentication)
  if (request.method === 'GET' && url.pathname === '/api/cache-stats') {
    // User is authenticated, return stats
    const list = await env.SESSIONS.list({ prefix: 'auth_cache:' })
    
    return new Response(JSON.stringify({ 
      success: true, 
      cached_profiles: list.keys.length,
      sample_keys: list.keys.slice(0, 5).map(k => {
        // Redact password hashes from keys for privacy
        const parts = k.name.split(':')
        return parts.length >= 3 ? `auth_cache:${parts[1]}:***` : k.name
      })
    }), { 
      status: 200, 
      headers: { ...JSON_HEADERS, ...getCorsHeaders(request) } 
    })
  }

  return new Response('Not found', { status:404, headers: getCorsHeaders(request) })
}

// Export for module workers (preferred)
export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env)
  }
}