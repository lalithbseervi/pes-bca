import { verifyTurnstile } from "../utils/cf-turnstile";
import { invalidateCachedAuth, verifyCachedCredentials } from "../utils/auth-cache";
import { cacheAuthResult } from "../utils/auth-cache";
import { makeCookieHeader } from "../utils/cookies";
import { getCorsHeaders } from "../utils/cors";

export async function loginHandler(request, env) {
  const url = new URL(request.url)
  const JSON_HEADERS = { 'Content-Type': 'application/json' }
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
        await invalidateCachedAuth(env, srn)
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