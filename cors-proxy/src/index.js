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
  return `session_token=${token}; Max-Age=${maxAgeSec}; Path=/; HttpOnly; Secure; SameSite=Lax`
}

// Helper to get CORS headers
function getCorsHeaders(request) {
  // For local development, accept common localhost origins
  const origin = request.headers.get('Origin')
  const allowedOrigin = origin || 'http://localhost:1111'
  
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
    let body
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

    // Authenticate credentials (forward to AUTH_API or demo fallback)
    const authApi = env.AUTH_API
    let authResult
    if (authApi) {
      try {
        const authResp = await fetch(authApi, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: srn, password, profile: true, fields: ['branch','semester','name'] })
        })
        authResult = await authResp.json()
        if (!authResp.ok || !authResult.profile) {
          return new Response(JSON.stringify({ success:false, message: authResult.message || 'invalid credentials' }), { status:401, headers: { ...JSON_HEADERS, ...getCorsHeaders(request) } })
        }
      } catch (e) {
        return new Response(JSON.stringify({ success:false, message:'auth backend error' }), { status:502, headers: { ...JSON_HEADERS, ...getCorsHeaders(request) } })
      }
    } else {
      // Demo fallback (NOT for production)
      if (password !== 'demo') {
        return new Response(JSON.stringify({ success:false, message:'invalid credentials (no AUTH_API configured)' }), { status:401, headers: { ...JSON_HEADERS, ...getCorsHeaders(request) } })
      }
      authResult = { profile: { name:'Demo User', branch:'BCA', semester:'1' } }
    }

    // create opaque session token and store in KV (SESSIONS binding)
    const array = crypto.getRandomValues(new Uint8Array(32))
    const token = Array.from(array).map(b => b.toString(16).padStart(2,'0')).join('')
    const ttlSec = 60 * 60 * 24 * 3 // 72 hours
    const session = {
      srn,
      profile: authResult.profile,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + ttlSec * 1000).toISOString()
    }

    await env.SESSIONS.put(token, JSON.stringify(session), { expirationTtl: ttlSec })

    const cookieHeader = makeCookieHeader(token, ttlSec)

    const resBody = { success:true, session: { srn: session.srn, profile: session.profile, expiresAt: session.expiresAt }, redirect: '/' }
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
    const expiredCookie = 'session_token=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax'
    return new Response(JSON.stringify({ success:true }), { 
      status:200, 
      headers: { 
        ...JSON_HEADERS, 
        ...getCorsHeaders(request),
        'Set-Cookie': expiredCookie 
      } 
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