import { getCorsHeaders } from "./utils/cors.js"
import { loginHandler } from "./api/login.js"
import { getSession } from "./api/session.js"
import { logoutHandler } from "./api/logout.js"
import { invalidateCache } from "./api/invalidate-cache.js"
import { getCacheStats } from "./api/cache-stats.js"
import { handleFormReq } from "./api/contributeForm.js"
import { handleCookielessEvent } from "./api/analytics.js"
import { uploadResourceToSupabase, resourceStreamFromSupabase, mintStreamToken } from "./api/rw-supabase.js"
import { getStatus, createIncident, addIncidentUpdate, updateComponentStatus } from "./api/status.js"
import { verifyAdminPassphrase, getResources, updateResource, deleteResource, getFilters } from "./api/admin.js"
import { getSubjectResources } from "./api/subject.js"
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
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Passphrase',
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

  // POST /api/mint-stream-token
  if (request.method === 'POST' && url.pathname === '/api/mint-stream-token') {
    return mintStreamToken(request, env);
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

  // GET /api/status - Public status page data
  if (request.method === 'GET' && url.pathname === '/api/status') {
    return getStatus(request, env)
  }

  // GET /api/subject/resources - Get subject resources organized hierarchically
  if (request.method === 'GET' && url.pathname === '/api/subject/resources') {
    return getSubjectResources(request, env)
  }

  // POST /api/admin/verify-passphrase - Verify admin passphrase
  if (request.method === 'POST' && url.pathname === '/api/admin/verify-passphrase') {
    return verifyAdminPassphrase(request, env)
  }

  // GET /api/admin/resources - Get all resources with pagination
  if (request.method === 'GET' && url.pathname === '/api/admin/resources') {
    return getResources(request, env)
  }

  // GET /api/admin/filters - Get available filter values
  if (request.method === 'GET' && url.pathname === '/api/admin/filters') {
    return getFilters(request, env)
  }

  // PATCH /api/admin/resources/:id - Update resource metadata
  const updateResourceMatch = url.pathname.match(/^\/api\/admin\/resources\/([^/]+)\/?$/);
  if (updateResourceMatch && request.method === 'PATCH') {
    const ctx = { params: { id: updateResourceMatch[1] } };
    return updateResource(request, env, ctx);
  }

  // DELETE /api/admin/resources/:id - Delete resource
  const deleteResourceMatch = url.pathname.match(/^\/api\/admin\/resources\/([^/]+)\/?$/);
  if (deleteResourceMatch && request.method === 'DELETE') {
    const ctx = { params: { id: deleteResourceMatch[1] } };
    return deleteResource(request, env, ctx);
  }

  // POST /api/status/incidents - Create new incident (authenticated)
  if (request.method === 'POST' && url.pathname === '/api/status/incidents') {
    return createIncident(request, env)
  }

  // POST /api/status/incidents/:id/updates - Add incident update (authenticated)
  const incidentUpdateMatch = url.pathname.match(/^\/api\/status\/incidents\/([^/]+)\/updates\/?$/);
  if (incidentUpdateMatch && request.method === 'POST') {
    const ctx = { params: { id: incidentUpdateMatch[1] } };
    return addIncidentUpdate(request, env, ctx);
  }

  // PATCH /api/status/components/:id - Update component status (authenticated)
  const componentMatch = url.pathname.match(/^\/api\/status\/components\/([^/]+)\/?$/);
  if (componentMatch && request.method === 'PATCH') {
    const ctx = { params: { id: componentMatch[1] } };
    return updateComponentStatus(request, env, ctx);
  }

  return new Response('Not found', { status:404, headers: getCorsHeaders(request) })
}

// Export for module workers (preferred)
export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env)
  }
}