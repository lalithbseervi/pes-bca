export async function onRequest(context) {
  // Proxy any /api/* request to configured backend (cors-proxy worker) so
  // auth endpoints become first-party (Set-Cookie will be scoped to Pages
  // domain). Configure CORS_PROXY_BASE in Pages environment to change the
  // upstream; default points to the existing devpages worker used in dev.
  const { request, env } = context;
  const url = new URL(request.url);

  const upstreamBase = env.CORS_PROXY_BASE || 'https://cors-proxy.devpages.workers.dev';

  // Build upstream URL keeping the /api path and query
  const apiIndex = url.pathname.indexOf('/api');
  const upstreamPath = apiIndex === -1 ? url.pathname : url.pathname.substring(apiIndex);
  const upstreamUrl = new URL(upstreamBase + upstreamPath + url.search);

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

  // Forward the request to upstream
  const fetchOpts = {
    method: request.method,
    headers: outHeaders,
    // forward body for non-GET/HEAD
    body: (request.method === 'GET' || request.method === 'HEAD') ? undefined : request.body,
    redirect: 'manual'
  };

  const resp = await fetch(upstreamUrl.toString(), fetchOpts);

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
