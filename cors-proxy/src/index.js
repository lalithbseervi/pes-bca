import { getCorsHeaders } from "./utils/cors.js"
import { loginHandler } from "./api/login.js"
import { getSession } from "./api/session.js"
import { logoutHandler } from "./api/logout.js"
import { invalidateCache } from "./api/invalidate-cache.js"
import { getCacheStats } from "./api/cache-stats.js"
import { handleFormReq } from "./api/contributeForm.js"
import { handleCookielessEvent } from "./api/analytics.js"
import { uploadResourceToSupabase, resourceStreamFromSupabase } from "./api/rw-supabase.js"
// JWT utils are used inside route handlers

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request, event.env || globalThis))
})

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
    return loginHandler(request, env)  
  }

  // GET /api/session
  if (request.method === 'GET' && url.pathname === '/api/session') {
    return getSession(request, env)
  }

  // POST /api/logout
  if (request.method === 'POST' && url.pathname === '/api/logout') {
    return logoutHandler(request, env)
  }

  // POST /api/resources/upload
  if (request.method === 'POST' && url.pathname === '/api/resources/upload') {
    return uploadResourceToSupabase(request, env)
  }

  // HEAD or GET /api/resources/:id/stream
  const streamMatch = url.pathname.match(/^\/api\/resources\/([^/]+)\/stream\/?$/);
  if (streamMatch && (request.method === 'GET' || request.method === 'HEAD')) {
      const ctx = { params: { id: streamMatch[1] } };
      return resourceStreamFromSupabase(request, env, ctx);
  }

  // POST /api/analytics/cookieless
  if (request.method === 'POST' && url.pathname === '/api/analytics/cookieless') {
    return handleCookielessEvent(request, env)
  }

  // POST /api/invalidate-cache/:srn
  // Endpoint to invalidate cached credentials (useful when password changes)
  if (request.method === 'POST' && url.pathname.startsWith('/api/invalidate-cache/')) {
    return invalidateCache(request, env)
  }

  // POST /api/contribute/
  // Endpoint for storing social ID of interested contributor
  if (request.method === 'POST' && url.pathname.startsWith('/api/contribute')) {
    return handleFormReq(request, env)
  }

  // GET /api/cache-stats
  // Endpoint to get cache statistics (requires authentication)
  if (request.method === 'GET' && url.pathname === '/api/cache-stats') {
    return getCacheStats(request, env)
  }

  return new Response('Not found', { status:404, headers: getCorsHeaders(request) })
}

// Export for module workers (preferred)
export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env)
  }
}