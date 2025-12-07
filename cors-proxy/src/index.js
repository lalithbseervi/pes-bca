import { getCorsHeaders } from "./utils/cors.js"
import { loginHandler } from "./api/login.js"
import { getSession } from "./api/session.js"
import { logoutHandler } from "./api/logout.js"
import { invalidateCache } from "./api/invalidate-cache.js"
import { getCacheStats } from "./api/cache-stats.js"
import { handleFormReq } from "./api/contributeForm.js"
import { handleDebugCookies } from "./api/debug.js"
import { uploadResourceToSupabase, resourceStreamFromSupabase } from "./api/rw-supabase.js"
import { getStatus, streamStatus, createIncident, addIncidentUpdate, updateComponentStatus } from "./api/status.js"
import { verifyAdminPassphrase, getResources as getAdminResources, updateResource, deleteResource, getFilters, replaceFile } from "./api/admin.js"
import { getFile } from "./api/file.js"
import { proxyAnalytics } from "./api/analytics.js"
import { getSubjectResources } from "./api/subject.js"
import { getResources } from "./api/resources.js"
// JWT utils are used inside route handlers

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request, event.env || globalThis))
})

async function handleRequest(request, env, ctx) {
  const url = new URL(request.url)
  const corsHeaders = getCorsHeaders(request)

  // Handle OPTIONS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders,
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Passphrase, If-None-Match',
        'Access-Control-Max-Age': '86400',
      }
    })
  }

  // Helper to add CORS headers to any response
  // This centralizes CORS handling so individual handlers don't need to include it
  const addCorsHeaders = (response) => {
    const newHeaders = new Headers(response.headers)
    Object.entries(corsHeaders).forEach(([key, value]) => {
      newHeaders.set(key, value)
    })
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders
    })
  }

  let response

  // POST /api/report/csp - Receive CSP violation reports (JSON or report body)
  if (request.method === 'POST' && url.pathname === '/api/report/csp') {
    try {
      const contentType = request.headers.get('Content-Type') || ''
      let bodyJson = {}
      if (contentType.includes('application/json')) {
        bodyJson = await request.json().catch(()=>({ parseError: true }))
      } else if (contentType.includes('application/reports+json')) {
        bodyJson = await request.json().catch(()=>({ parseError: true }))
      } else {
        const text = await request.text().catch(()=> '')
        bodyJson = { raw: text }
      }
      // Minimal sampling: ignore empty bodies
      if (Object.keys(bodyJson).length === 0) {
        return addCorsHeaders(new Response(JSON.stringify({ ok: true, ignored: true }), { status: 202, headers: { 'Content-Type': 'application/json' } }))
      }
      // Store in analytics durable object / KV if available
      try {
        // If env.CSP_REPORTS is a KV namespace
        if (env && env.CSP_REPORTS && env.CSP_REPORTS.put) {
          const key = `r:${Date.now()}:${Math.random().toString(36).slice(2,8)}`
          await env.CSP_REPORTS.put(key, JSON.stringify(bodyJson))
        }
      } catch (e) {
        // swallow storage errors
      }
      return addCorsHeaders(new Response(JSON.stringify({ ok: true }), { status: 201, headers: { 'Content-Type': 'application/json' } }))
    } catch (e) {
      return addCorsHeaders(new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } }))
    }
  }

  // POST /api/login
  if (request.method === 'POST' && url.pathname === '/api/login') {
    response = await loginHandler(request, env, ctx)
    return addCorsHeaders(response)
  }

  // GET /api/session
  if (request.method === 'GET' && url.pathname === '/api/session') {
    response = await getSession(request, env)
    return addCorsHeaders(response)
  }

  // POST /api/logout
  if (request.method === 'POST' && url.pathname === '/api/logout') {
    response = await logoutHandler(request, env)
    return addCorsHeaders(response)
  }

  // POST /api/resources/upload
  if (request.method === 'POST' && url.pathname === '/api/resources/upload') {
    response = await uploadResourceToSupabase(request, env)
    return addCorsHeaders(response)
  }


  // HEAD or GET /api/resources/sem-{N}/{subject}/{resource_type}/unit-all/{filename} - Semantic path for unit-all
  const semanticAllUnitMatch = url.pathname.match(/^\/api\/resources\/sem-(\d+)\/([^/]+)\/([^/]+)\/unit-all\/([^/]+)\/?$/);
  if (semanticAllUnitMatch && (request.method === 'GET' || request.method === 'HEAD')) {
      const semester = semanticAllUnitMatch[1];
      const subject = semanticAllUnitMatch[2];
      const resource_type = semanticAllUnitMatch[3];
      const filename = semanticAllUnitMatch[4];
      const ctx = {
        params: {
          semester: `sem-${semester}`,
          subject: subject,
          resource_type: resource_type,
          unit: 'all',
          filename: filename
        },
        lookupBy: 'filename'
      };
      response = await resourceStreamFromSupabase(request, env, ctx);
      return addCorsHeaders(response)
  }

  // HEAD or GET /api/resources/sem-{N}/{subject}/unit-{N}/{filename} - Semantic path for regular units
  const semanticStreamMatch = url.pathname.match(/^\/api\/resources\/sem-(\d+)\/([^/]+)\/unit-(\d+)\/([^/]+)\/?$/);
  if (semanticStreamMatch && (request.method === 'GET' || request.method === 'HEAD')) {
      const semester = semanticStreamMatch[1];
      const subject = semanticStreamMatch[2];
      const unit = semanticStreamMatch[3];
      const filename = semanticStreamMatch[4];
      const ctx = { 
        params: { 
          semester: `sem-${semester}`,
          subject: subject,
          unit: unit,
          filename: filename
        },
        lookupBy: 'filename'
      };
      response = await resourceStreamFromSupabase(request, env, ctx);
      return addCorsHeaders(response)
  }

  // HEAD or GET /api/resources/:id/stream - Legacy ID-based lookup
  const streamMatch = url.pathname.match(/^\/api\/resources\/([^/]+)\/stream\/?$/);
  if (streamMatch && (request.method === 'GET' || request.method === 'HEAD')) {
      const ctx = { params: { id: streamMatch[1] } };
      response = await resourceStreamFromSupabase(request, env, ctx);
      return addCorsHeaders(response)
  }

  // POST /api/analytics/cookieless
  if (request.method === 'POST' && url.pathname === '/api/analytics/cookieless') {
    response = await handleCookielessEvent(request, env)
    return addCorsHeaders(response)
  }

  // GET /api/debug/cookies - debug endpoint to inspect the Cookie header seen by the worker
  if (request.method === 'GET' && url.pathname === '/api/debug/cookies') {
    response = await handleDebugCookies(request, env)
    return addCorsHeaders(response)
  }

  // POST /api/invalidate-cache/:srn
  // Endpoint to invalidate cached credentials (useful when password changes)
  if (request.method === 'POST' && url.pathname.startsWith('/api/invalidate-cache/')) {
    response = await invalidateCache(request, env)
    return addCorsHeaders(response)
  }

  // POST /api/contribute/
  // Endpoint for storing social ID of interested contributor
  if (request.method === 'POST' && url.pathname.startsWith('/api/contribute')) {
    response = await handleFormReq(request, env)
    return addCorsHeaders(response)
  }

  // GET /api/cache-stats
  // Endpoint to get cache statistics (requires authentication)
  if (request.method === 'GET' && url.pathname === '/api/cache-stats') {
    response = await getCacheStats(request, env)
    return addCorsHeaders(response)
  }

  // GET /api/status - Public status page data
  if (request.method === 'GET' && url.pathname === '/api/status') {
    response = await getStatus(request, env)
    return addCorsHeaders(response)
  }

  // GET /api/status/stream - Server-Sent Events for real-time status updates
  if (request.method === 'GET' && url.pathname === '/api/status/stream') {
    response = await streamStatus(request, env)
    return addCorsHeaders(response)
  }

  // GET /api/resources - Get all resources with optional filters
  if (request.method === 'GET' && url.pathname === '/api/resources') {
    response = await getResources(request, env)
    return addCorsHeaders(response)
  }

  // GET /api/subject/resources - Get resources for a specific subject
  if (request.method === 'GET' && url.pathname === '/api/subject/resources') {
    response = await getSubjectResources(request, env)
    return addCorsHeaders(response)
  }

  // GET /api/file/:storageKey - Get file via signed URL redirect
  const fileMatch = url.pathname.match(/^\/api\/file\/(.+)$/);
  if (fileMatch && request.method === 'GET') {
    const ctx = { params: { storageKey: fileMatch[1] } };
    response = await getFile(request, env, ctx);
    return addCorsHeaders(response)
  }

  // POST /api/analytics/proxy - Route analytics events via Worker (strip PII)
  if (request.method === 'POST' && url.pathname === '/api/analytics/proxy') {
    response = await proxyAnalytics(request, env);
    return addCorsHeaders(response)
  }

  // GET /api/rate-limit/status - Check current rate-limit status (does NOT consume a request)
  if (request.method === 'GET' && url.pathname === '/api/rate-limit/status') {
    const { checkRateLimit, deriveRateLimitIdentity } = await import('./utils/rate-limit.js');
    const identity = await deriveRateLimitIdentity(request, env);
    const info = await checkRateLimit(identity, env, { consume: false });
    const body = JSON.stringify({
      allowed: info.allowed,
      remaining: info.remaining,
      resetAt: info.resetAt,
      penaltyActive: info.penaltyActive,
      violationCount: info.violationCount,
      retryAfter: info.retryAfter || null,
      limit: info.limit,
      identity
    });
    response = new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
    return addCorsHeaders(response)
  }

  // POST /api/admin/verify-passphrase - Verify admin passphrase
  if (request.method === 'POST' && url.pathname === '/api/admin/verify-passphrase') {
    response = await verifyAdminPassphrase(request, env)
    return addCorsHeaders(response)
  }

  // GET /api/admin/resources - Get all resources with pagination
  if (request.method === 'GET' && url.pathname === '/api/admin/resources') {
    response = await getAdminResources(request, env)
    return addCorsHeaders(response)
  }

  // GET /api/admin/filters - Get available filter values
  if (request.method === 'GET' && url.pathname === '/api/admin/filters') {
    response = await getFilters(request, env)
    return addCorsHeaders(response)
  }

  // PUT /api/admin/resources/:id/file - Replace file
  const replaceFileMatch = url.pathname.match(/^\/api\/admin\/resources\/([^/]+)\/file\/?$/);
  if (replaceFileMatch && request.method === 'PUT') {
    const ctx = { params: { id: replaceFileMatch[1] } };
    response = await replaceFile(request, env, ctx);
    return addCorsHeaders(response)
  }

  // PATCH /api/admin/resources/:id - Update resource metadata
  const updateResourceMatch = url.pathname.match(/^\/api\/admin\/resources\/([^/]+)\/?$/);
  if (updateResourceMatch && request.method === 'PATCH') {
    const ctx = { params: { id: updateResourceMatch[1] } };
    response = await updateResource(request, env, ctx);
    return addCorsHeaders(response)
  }

  // DELETE /api/admin/resources/:id - Delete resource
  const deleteResourceMatch = url.pathname.match(/^\/api\/admin\/resources\/([^/]+)\/?$/);
  if (deleteResourceMatch && request.method === 'DELETE') {
    const ctx = { params: { id: deleteResourceMatch[1] } };
    response = await deleteResource(request, env, ctx);
    return addCorsHeaders(response)
  }

  // POST /api/status/incidents - Create new incident (authenticated)
  if (request.method === 'POST' && url.pathname === '/api/status/incidents') {
    response = await createIncident(request, env)
    return addCorsHeaders(response)
  }

  // POST /api/status/incidents/:id/updates - Add incident update (authenticated)
  const incidentUpdateMatch = url.pathname.match(/^\/api\/status\/incidents\/([^/]+)\/updates\/?$/);
  if (incidentUpdateMatch && request.method === 'POST') {
    const ctx = { params: { id: incidentUpdateMatch[1] } };
    response = await addIncidentUpdate(request, env, ctx);
    return addCorsHeaders(response)
  }

  // PATCH /api/status/components/:id - Update component status (authenticated)
  const componentMatch = url.pathname.match(/^\/api\/status\/components\/([^/]+)\/?$/);
  if (componentMatch && request.method === 'PATCH') {
    const ctx = { params: { id: componentMatch[1] } };
    response = await updateComponentStatus(request, env, ctx);
    return addCorsHeaders(response)
  }

  return new Response('Not found', { status:404, headers: corsHeaders })
}

// Export for module workers (preferred)
export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, ctx)
  }
}