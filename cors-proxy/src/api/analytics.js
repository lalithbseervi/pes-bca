export async function handleCookielessEvent(request, env) {
  console.log('handleCookielessEvent: incoming', request.method, request.url);
  const JSON_HEADERS = { 'Content-Type': 'application/json' };

  let body;
  try {
    body = await request.json();
    console.log('handleCookielessEvent: body', body);
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: 'invalid_json' }), { status: 400, headers: JSON_HEADERS });
  }

  // validate minimum
  const eventName = typeof body.event === 'string' ? body.event : 'client_event';
  const props = (body.props && typeof body.props === 'object') ? body.props : {};

  // Use env var for write key and optional host
  const WRITE_KEY = env.POSTHOG_WRITE_KEY;
  const PH_HOST = env.POSTHOG_HOST || 'https://app.posthog.com';

  if (!WRITE_KEY) {
    return new Response(JSON.stringify({ success: false, error: 'no_write_key' }), { status: 500, headers: JSON_HEADERS });
  }

  // Build PostHog payload. Do NOT set a persistent distinct_id for privacy.
  const payload = {
    api_key: WRITE_KEY,
    event: eventName,
    properties: {
      ...props,
      _cookieless: true
    }
  };

  const genId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : (`cookieless-${Date.now()}-${Math.random().toString(36).slice(2,10)}`);
  if (!payload.properties) payload.properties = {};
  if (!payload.properties.distinct_id) payload.properties.distinct_id = genId;

  try {
    const resp = await fetch(`${PH_HOST}/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${WRITE_KEY}` },
      body: JSON.stringify(payload)
    });
    console.log('handleCookielessEvent: forwarded to PostHog, status', resp.status);

    try {
      const text = await resp.text();
      console.log('handleCookielessEvent: posthog response body:', text);
    } catch (e) {
      console.log('handleCookielessEvent: failed to read posthog response body', e);
    }

    if (!resp.ok) {
      return new Response(JSON.stringify({ success: false, forwarded: false }), { status: 502, headers: JSON_HEADERS });
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: JSON_HEADERS });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: String(err) }), { status: 502, headers: JSON_HEADERS });
  }
}