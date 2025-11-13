export async function onRequest(context) {
  // Proxy any /api/* request to configured backend (cors-proxy worker) so
  // auth endpoints become first-party (Set-Cookie will be scoped to Pages
  // domain). Configure CORS_PROXY_BASE in Pages environment to change the
  // upstream; default points to the existing devpages worker used in dev.
  const { request, env } = context;
  const url = new URL(request.url);

  // By default forward to the current Pages origin so the cors-proxy is called
  // directly (first-party). An explicit CORS_PROXY_BASE env var can override
  // this for testing or alternate deployments.
  const upstreamBase = env.CORS_PROXY_BASE || url.origin;

  // Build upstream URL keeping the /api path and query
  const apiIndex = url.pathname.indexOf('/api');
  const upstreamPath = apiIndex === -1 ? url.pathname : url.pathname.substring(apiIndex);
  const upstreamUrl = new URL(upstreamBase + upstreamPath + url.search);

  // Diagnostic log to confirm invocation and routing. Visible in Pages Functions logs.
  try { console.log('Pages Function invoked', { method: request.method, path: url.pathname, upstream: upstreamUrl.toString() }) } catch (e) {}

  // Quick, gated diagnostics: if caller includes ?diag=1 return a small JSON
  // echo so you can confirm the Pages Function is reached from the browser
  // (safe: filters out sensitive headers). This does not affect normal
  // routing when the query param is absent.
  try {
    if (url.searchParams.get('diag') === '1') {
      const safeHeaders = {};
      for (const [k, v] of request.headers) {
        const lk = k.toLowerCase();
        if (['authorization', 'cookie', 'set-cookie', 'proxy-authorization'].includes(lk)) continue;
        safeHeaders[k] = v;
      }
      const diag = {
        pagesInvoked: true,
        method: request.method,
        pathname: url.pathname,
        upstream: upstreamUrl.toString(),
        headers: safeHeaders
      };
      const origin = request.headers.get('Origin') || request.headers.get('origin') || url.origin;
      return new Response(JSON.stringify(diag, null, 2), { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' } });
    }
  } catch (e) {
    try { console.error('diag handler error', e) } catch (e2) {}
  }

  // Clone headers from incoming request but avoid forwarding hop-by-hop headers
  const outHeaders = new Headers();
  for (const [k, v] of request.headers) {
    if (['host', 'content-length', 'connection', 'upgrade', 'expect', 'proxy-authorization'].includes(k.toLowerCase())) continue;
    outHeaders.set(k, v);
  }

  // Forward the client's Origin so upstream worker can produce appropriate CORS
  if (!outHeaders.get('Origin') && request.headers.get('origin')) {
    outHeaders.set('Origin', request.headers.get('origin'));
  }

  // If this is an OPTIONS preflight, answer locally to avoid forwarding
  // preflight requests that upstream may not accept.
  if (request.method === 'OPTIONS') {
    try { console.log('Handling OPTIONS preflight locally for', url.pathname) } catch (e) {}
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': request.headers.get('Origin') || request.headers.get('origin') || url.origin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': request.headers.get('access-control-request-headers') || 'Content-Type, Authorization, X-Admin-Passphrase',
        'Access-Control-Max-Age': '86400'
      }
    })
  }

  // Use the original request as the base for the upstream request. Constructing
  // a new Request from the incoming one (but with the upstream URL) preserves
  // method, body, and other properties reliably across environments and avoids
  // subtle body/stream issues that can cause upstream 405 responses.
  const upstreamRequest = new Request(upstreamUrl.toString(), request);
  // Remove hop-by-hop headers that shouldn't be forwarded
  upstreamRequest.headers.delete('host');
  upstreamRequest.headers.delete('connection');
  upstreamRequest.headers.delete('upgrade');
  upstreamRequest.headers.delete('expect');
  upstreamRequest.headers.delete('proxy-authorization');

  let resp;
  try {
    resp = await fetch(upstreamRequest, { redirect: 'manual' });
  } catch (err) {
    try { console.error('Upstream fetch failed', String(err), upstreamUrl.toString()) } catch (e) {}
    return new Response(JSON.stringify({ ok: false, error: 'upstream fetch failed', detail: String(err) }), { status: 502, headers: { 'Content-Type': 'application/json' } })
  }

  // If upstream returns an error, log a snippet of the body to aid debugging
  if (resp.status >= 400) {
    try {
      const clone = resp.clone();
      const text = await clone.text().catch(()=>'<unreadable>');
      try { console.warn('Upstream error', { status: resp.status, statusText: resp.statusText, body: text.slice(0,2000) }) } catch (e) {}
    } catch (e) {
      // ignore logging errors
    }
    // Return a short diagnostic JSON when upstream returns >=400 to help
    // debugging of 4xx/5xx responses (temporary). Filter out sensitive
    // headers (Set-Cookie, Authorization, Cookie, Proxy-Authorization).
    try {
      const clone2 = resp.clone();
      const bodyText = await clone2.text().catch(()=>'<unreadable>');
      const safeHeaders = {};
      for (const [k,v] of resp.headers) {
        const lk = k.toLowerCase();
        if (['set-cookie','authorization','cookie','proxy-authorization'].includes(lk)) continue;
        safeHeaders[k] = v;
      }
      const diag = {
        debug: true,
        pagesInvoked: true,
        upstreamUrl: upstreamUrl.toString(),
        upstreamStatus: resp.status,
        upstreamStatusText: resp.statusText,
        upstreamHeaders: safeHeaders,
        upstreamBodySnippet: (bodyText && bodyText.slice) ? bodyText.slice(0,2000) : String(bodyText)
      };
      return addCorsHeaders(new Response(JSON.stringify(diag, null, 2), { status: resp.status, headers: { 'Content-Type': 'application/json' } }));
    } catch (e) {
      try { console.error('Error preparing debug response', e) } catch (e2) {}
    }
  }

  // Return upstream response directly. This will forward Set-Cookie headers
  // from the upstream to the client, which causes cookies to be set for the
  // Pages origin (first-party) instead of the upstream worker origin.
  const respHeaders = new Headers(resp.headers);

  // Ensure we don't accidentally expose internal CORS headers from upstream
  // — set Access-Control-Allow-Origin to the incoming Origin for same-origin usage.
  const origin = request.headers.get('Origin') || request.headers.get('origin') || url.origin;
  respHeaders.set('Access-Control-Allow-Origin', origin);
  respHeaders.set('Access-Control-Allow-Credentials', 'true');

  // Create and return a new Response so we can control headers easily
  const body = await resp.arrayBuffer();
  return new Response(body, {
    status: resp.status,
    statusText: resp.statusText,
    headers: respHeaders
  });
}
