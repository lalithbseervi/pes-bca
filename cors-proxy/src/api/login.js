import { invalidateCachedAuth, verifyCachedCredentials, cacheAuthResult } from "../utils/auth-cache.js";
import { makeCookie } from "../utils/cookies.js";
import { signJWT } from "../utils/sign_jwt.js";

export async function loginHandler(request, env) {
  const url = new URL(request.url)
  const JSON_HEADERS = { 'Content-Type': 'application/json' }
  let body;
    
  try { body = await request.json() } catch (e) {
    return new Response(JSON.stringify({ success:false, message:'invalid json' }), { status:400, headers: JSON_HEADERS })
  }

  const { srn, password } = body

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
    if (!authApi) { return new Response(JSON.stringify({ success:false, message:'invalid config (no AUTH_API given)' }), { status:401, headers: JSON_HEADERS })      } else {
      try {
      const authResp = await fetch(authApi, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: srn, password, profile: true, fields: ['branch','semester','name'] })
      })
      const authResult = await authResp.json()
        
      if (!authResp.ok || !authResult.profile) {
        await invalidateCachedAuth(env, srn)
        return new Response(JSON.stringify({ success:false, message: authResult.message || 'invalid credentials' }), { status:401, headers: JSON_HEADERS })
      }
        
      profile = authResult.profile
      
      // Cache the successful authentication
      await cacheAuthResult(env, srn, password, profile)
      console.log(`Cached credentials for ${srn}`)
      
      } catch (e) {
        console.error('Auth API error:', e)
        return new Response(JSON.stringify({ success:false, message:'auth backend error' }), { status:502, headers: JSON_HEADERS })
      }
    }
  }

  // Issue JWT cookies (no KV session storage)
  const accessTTL = 24 * 60 * 60 // 24 hours
  const refreshTTL = 7 * 24 * 60 * 60 // 7 days

  const accessJwt = await signJWT({ sub: srn, type: 'access', profile }, env.JWT_SECRET, accessTTL)
  const refreshJwt = await signJWT({ sub: srn, type: 'refresh', profile }, env.JWT_SECRET, refreshTTL)

  // Determine redirect path
  const redirectPath = url.searchParams.get('redirect') || request.headers.get('Referer') || '/'

  const resBody = { 
    success: true, 
    session: { srn, profile: profile, expiresAt: new Date(Date.now() + accessTTL * 1000).toISOString() }, 
    redirect: redirectPath,
    cached: cachedAuth.success
  }

  // Set both cookies
  const headers = new Headers(JSON_HEADERS)
  headers.append('Set-Cookie', makeCookie('access_token', accessJwt, accessTTL, request))
  headers.append('Set-Cookie', makeCookie('refresh_token', refreshJwt, refreshTTL, request))

  return new Response(JSON.stringify(resBody), { status: 200, headers })
}