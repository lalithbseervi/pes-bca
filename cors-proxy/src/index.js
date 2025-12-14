import { getCorsHeaders } from "./utils/cors.js"
import { createLogger } from "./utils/logger.js"
import { getCourseCodeFromProfile, getCourseName } from "./utils/course.js"
import { resolveCourseFromProfile, authenticateRequest } from "./utils/auth-helpers.js"
import { loginHandler } from "./api/login.js"
import { getSession } from "./api/session.js"
import { logoutHandler } from "./api/logout.js"
import { invalidateCache } from "./api/invalidate-cache.js"
import { getCacheStats } from "./api/cache-stats.js"
import { handleFormReq } from "./api/contributeForm.js"
import { handleDebugCookies } from "./api/debug.js"
import { uploadResourceToSupabase, resourceStreamFromSupabase } from "./api/rw-supabase.js"
import { getStatus, streamStatus, createIncident, addIncidentUpdate, updateComponentStatus, getStatusErrors } from "./api/status.js"
import { streamSystemStatus } from "./api/system-status-stream.js"
import { checkAdminAccess, getResources as getAdminResources, updateResource, deleteResource, getFilters, replaceFile, getSystemConfig, updateSystemConfig } from "./api/admin.js"
import { getSubjectsConfig, createSubject, updateSubject, deleteSubject, getAllCourses, getAllSemesters } from "./api/subjects-config.js"
import { getFile } from "./api/file.js"
import { proxyAnalytics } from "./api/analytics.js"
import { getSubjectResources } from "./api/subject.js"
import { getSubjectMeta } from "./api/subject-meta.js"
import { serveSubjectPage } from "./api/subject-page.js"
import { getResources } from "./api/resources.js"
import { reportError, getPublicSystemStatus } from "./api/system-status.js"

const log = createLogger('Router');

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
        'Access-Control-Allow-Methods': 'GET, PUT, POST, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Passphrase, If-None-Match',
        'Access-Control-Max-Age': '86400',
      }
    })
  }

  // Helper to add CORS headers and auto-report 5XX errors
  // Returns a Promise<Response> so callers can return it directly
  const addCorsHeaders = async (response) => {
    // Auto-report 5XX responses via report-error endpoint
    try {
      if (response && response.status >= 500 && response.status < 600 && url.pathname !== '/api/system/report-error') {
        const payload = {
          statusCode: response.status,
          url: request.url,
          error: response.statusText || 'Server error',
          timestamp: Date.now(),
          userAgent: request.headers.get('User-Agent') || 'unknown'
        };
        const autoReportRequest = new Request(url.origin + '/api/system/report-error', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        await reportError(autoReportRequest, env);
      }
    } catch (e) {
      log.error('Auto error reporting failed', e);
    }

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

  // GET /sem-{semester}/{subject} - Dynamic subject pages (no markdown dependency)
  const subjectPageMatch = url.pathname.match(/^\/sem-(\d+)\/([a-z0-9_-]+)\/?$/);
  if (subjectPageMatch && request.method === 'GET') {
    const semester = subjectPageMatch[1];
    const subjectCode = subjectPageMatch[2];
    response = await serveSubjectPage(request, env, semester, subjectCode);
    return response; // Don't add CORS headers to HTML responses
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

  // GET /api/system/status - Public read-only endpoint for maintenance mode and announcements
  if (request.method === 'GET' && url.pathname === '/api/system/status') {
    response = await getPublicSystemStatus(env)
    return addCorsHeaders(response)
  }

  // GET /api/system/status/stream - Server-Sent Events stream for real-time system status updates
  if (request.method === 'GET' && url.pathname === '/api/system/status/stream') {
    response = await streamSystemStatus(request, env)
    return response // Don't add CORS headers to SSE streams
  }

  // GET /api/status/errors - 5XX error metrics for status page graphs
  if (request.method === 'GET' && url.pathname === '/api/status/errors') {
    response = await getStatusErrors(request, env)
    return addCorsHeaders(response)
  }

  // POST /api/system/report-error - Report 5XX errors from clients for monitoring
  if (request.method === 'POST' && url.pathname === '/api/system/report-error') {
    response = await reportError(request, env)
    return addCorsHeaders(response)
  }

  // GET /api/status/errors - 5XX error metrics for status page graphs
  if (request.method === 'GET' && url.pathname === '/api/status/errors') {
    response = await getStatusErrors(request, env)
    return addCorsHeaders(response)
  }

  // POST /api/system/report-error - Report 5XX errors for monitoring
  if (request.method === 'POST' && url.pathname === '/api/system/report-error') {
    response = await reportError(request, env)
    return addCorsHeaders(response)
  }

  // POST /api/resources/upload
  if (request.method === 'POST' && url.pathname === '/api/resources/upload') {
    response = await uploadResourceToSupabase(request, env)
    return addCorsHeaders(response)
  }

  // HEAD or GET /api/resources/sem-{N}/{subject}/[resource_type/]{unit-{all|N}}/{filename}
  // Supports both current semantic path (with resource_type) and the earlier form without it.
  const semanticResourceMatch = url.pathname.match(/^\/api\/resources\/sem-(\d+)\/([^/]+)(?:\/([^/]+))?\/unit-(all|\d+)\/([^/]+)\/?$/);
  if (semanticResourceMatch && (request.method === 'GET' || request.method === 'HEAD')) {
      const semesterNumber = semanticResourceMatch[1];
      const subject = semanticResourceMatch[2];
      const maybeResourceType = semanticResourceMatch[3];
      const unit = semanticResourceMatch[4];
      const filename = semanticResourceMatch[5];

      const params = {
        semester: `sem-${semesterNumber}`,
        subject,
        unit,
        filename
      };

      if (maybeResourceType) {
        params.resource_type = maybeResourceType;
      }

      const ctx = { params, lookupBy: 'filename' };
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
    response = await proxyAnalytics(request, env)
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

  // GET /api/subjects - Authenticated list for the logged-in user's course
  if (request.method === 'GET' && url.pathname === '/api/subjects') {
    const auth = await authenticateRequest(request, env, { requireCourse: true })
    if (!auth.ok) {
      response = new Response(JSON.stringify({ success: false, error: auth.error }), {
        status: auth.status,
        headers: { 'Content-Type': 'application/json' }
      })
      return addCorsHeaders(response)
    }

    const profile = auth.profile || auth.payload?.profile || null
    // Resolve course from profile (tries profile.course, exact match, then fuzzy match)
    let courseId = auth.course || resolveCourseFromProfile(profile)
    if (!courseId) {
      response = new Response(JSON.stringify({ success: false, error: 'missing_course', details: { program: profile?.program, branch: profile?.branch } }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
      return addCorsHeaders(response)
    }

    try {
      const data = await getSubjectsConfig(env, courseId)
      const subjects = data[courseId] || {}
      const semesters = Object.keys(subjects).sort((a, b) => {
        const anum = (a.match(/(\d+)/) || [])[1]
        const bnum = (b.match(/(\d+)/) || [])[1]
        return (Number(anum) || 0) - (Number(bnum) || 0)
      })

      response = new Response(JSON.stringify({
        success: true,
        course: courseId,
        course_name: getCourseName(courseId) || profile?.branch || null,
        semesters,
        subjects
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
      return addCorsHeaders(response)
    } catch (e) {
      response = new Response(JSON.stringify({ success: false, error: 'subjects_fetch_failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      })
      return addCorsHeaders(response)
    }
  }

  // GET /api/subject/resources - Get resources for a specific subject
  if (request.method === 'GET' && url.pathname === '/api/subject/resources') {
    response = await getSubjectResources(request, env)
    return addCorsHeaders(response)
  }

  // GET /api/subjects/:code/meta - Get subject metadata
  const subjectMetaMatch = url.pathname.match(/^\/api\/subjects\/([a-z0-9_-]+)\/meta$/);
  if (subjectMetaMatch && request.method === 'GET') {
    const subjectCode = subjectMetaMatch[1];
    response = await getSubjectMeta(request, env, subjectCode);
    return addCorsHeaders(response);
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

  // GET /api/admin/check-access - Check if user has admin access
  if (request.method === 'GET' && url.pathname === '/api/admin/check-access') {
    response = await checkAdminAccess(request, env)
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

  // GET /api/admin/config - Get system configuration
  if (request.method === 'GET' && url.pathname === '/api/admin/config') {
    response = await getSystemConfig(request, env)
    return addCorsHeaders(response)
  }

  // PUT /api/admin/config - Update system configuration
  if (request.method === 'PUT' && url.pathname === '/api/admin/config') {
    response = await updateSystemConfig(request, env)
    return addCorsHeaders(response)
  }

  // Admin resource operations (file replace / metadata update / delete)
  const adminResourceMatch = url.pathname.match(/^\/api\/admin\/resources\/([^/]+)(?:\/(file))?\/?$/);
  if (adminResourceMatch) {
    const id = adminResourceMatch[1];
    const trailingSegment = adminResourceMatch[2];
    const ctx = { params: { id } };

    if (trailingSegment === 'file' && request.method === 'PUT') {
      response = await replaceFile(request, env, ctx);
      return addCorsHeaders(response)
    }

    if (!trailingSegment && request.method === 'PATCH') {
      response = await updateResource(request, env, ctx);
      return addCorsHeaders(response)
    }

    if (!trailingSegment && request.method === 'DELETE') {
      response = await deleteResource(request, env, ctx);
      return addCorsHeaders(response)
    }
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

  // GET /api/admin/subjects - Get all subjects config
  if (request.method === 'GET' && url.pathname === '/api/admin/subjects') {
    try {
      const authUser = await checkAdminAccess(request, env)
      if (!authUser) {
        response = new Response(JSON.stringify({ error: 'Unauthorized' }), { 
          status: 401, 
          headers: { 'Content-Type': 'application/json' } 
        });
        return addCorsHeaders(response);
      }
      
      const data = await getSubjectsConfig(env);
      response = new Response(JSON.stringify(data), { 
        status: 200, 
        headers: { 'Content-Type': 'application/json' } 
      });
      return addCorsHeaders(response);
    } catch (e) {
      response = new Response(JSON.stringify({ error: e.message }), { 
        status: 500, 
        headers: { 'Content-Type': 'application/json' } 
      });
      return addCorsHeaders(response);
    }
  }

  // POST /api/admin/subjects - Create new subject
  if (request.method === 'POST' && url.pathname === '/api/admin/subjects') {
    try {
      const authUser = await checkAdminAccess(request, env)
      if (!authUser) {
        response = new Response(JSON.stringify({ error: 'Unauthorized' }), { 
          status: 401, 
          headers: { 'Content-Type': 'application/json' } 
        });
        return addCorsHeaders(response);
      }

      const body = await request.json();
      const { course_id, semester, subject_code, subject_name, display_order } = body;

      if (!course_id || !semester || !subject_code || !subject_name) {
        response = new Response(JSON.stringify({ error: 'Missing required fields' }), { 
          status: 400, 
          headers: { 'Content-Type': 'application/json' } 
        });
        return addCorsHeaders(response);
      }

      const subject = await createSubject(env, course_id, semester, subject_code, subject_name, display_order || 0);
      response = new Response(JSON.stringify({ success: true, data: subject }), { 
        status: 201, 
        headers: { 'Content-Type': 'application/json' } 
      });
      return addCorsHeaders(response);
    } catch (e) {
      response = new Response(JSON.stringify({ error: e.message }), { 
        status: 500, 
        headers: { 'Content-Type': 'application/json' } 
      });
      return addCorsHeaders(response);
    }
  }

  // PATCH /api/admin/subjects/:id - Update subject
  const subjectUpdateMatch = url.pathname.match(/^\/api\/admin\/subjects\/([^/]+)\/?$/);
  if (subjectUpdateMatch && request.method === 'PATCH') {
    try {
      const authUser = await checkAdminAccess(request, env)
      if (!authUser) {
        response = new Response(JSON.stringify({ error: 'Unauthorized' }), { 
          status: 401, 
          headers: { 'Content-Type': 'application/json' } 
        });
        return addCorsHeaders(response);
      }

      const id = subjectUpdateMatch[1];
      const updates = await request.json();
      const subject = await updateSubject(env, id, updates);
      response = new Response(JSON.stringify({ success: true, data: subject }), { 
        status: 200, 
        headers: { 'Content-Type': 'application/json' } 
      });
      return addCorsHeaders(response);
    } catch (e) {
      response = new Response(JSON.stringify({ error: e.message }), { 
        status: 500, 
        headers: { 'Content-Type': 'application/json' } 
      });
      return addCorsHeaders(response);
    }
  }

  // DELETE /api/admin/subjects/:id - Delete subject
  const subjectDeleteMatch = url.pathname.match(/^\/api\/admin\/subjects\/([^/]+)\/?$/);
  if (subjectDeleteMatch && request.method === 'DELETE') {
    try {
      const authUser = await checkAdminAccess(request, env)
      if (!authUser) {
        response = new Response(JSON.stringify({ error: 'Unauthorized' }), { 
          status: 401, 
          headers: { 'Content-Type': 'application/json' } 
        });
        return addCorsHeaders(response);
      }

      const id = subjectDeleteMatch[1];
      await deleteSubject(env, id);
      response = new Response(JSON.stringify({ success: true }), { 
        status: 200, 
        headers: { 'Content-Type': 'application/json' } 
      });
      return addCorsHeaders(response);
    } catch (e) {
      response = new Response(JSON.stringify({ error: e.message }), { 
        status: 500, 
        headers: { 'Content-Type': 'application/json' } 
      });
      return addCorsHeaders(response);
    }
  }

  return new Response('Not found', { status:404, headers: corsHeaders })
}

// Export for module workers (preferred)
export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, ctx)
  }
}