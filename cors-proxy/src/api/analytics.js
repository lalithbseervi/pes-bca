// Analytics proxy: forwards events to PostHog while stripping PII

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function sanitizeProps(props, opted_out) {
  const p = { ...(props || {}) };
  if (opted_out) {
    delete p.email;
    delete p.name;
    delete p.user_id;
    delete p.phone;
    delete p.$set;
    delete p.$ip;
  }
  p.$lib = 'worker-proxy';
  p.$time = new Date().toISOString();
  return p;
}

export async function proxyAnalytics(request, env) {
  try {
    const contentType = request.headers.get('Content-Type') || '';
    if (!contentType.includes('application/json')) {
      return jsonResponse({ error: 'Invalid content type' }, 400);
    }

    const body = await request.json();
    const { event, props = {}, distinct_id, opted_out } = body;

    if (!event) {
      return jsonResponse({ error: 'Missing event name' }, 400);
    }

    const safeProps = sanitizeProps(props, opted_out);

    const payload = {
      api_key: env.POSTHOG_WRITE_KEY,
      event,
      properties: safeProps,
      distinct_id: distinct_id || undefined,
    };

    const url = (env.PH_HOST || 'https://us.posthog.com') + '/capture/';

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const txt = await res.text();
      return jsonResponse({ error: 'Upstream error', status: res.status, details: txt }, 502);
    }

    return jsonResponse({ ok: true }, 200);
  } catch (e) {
    return jsonResponse({ error: 'Internal error', message: e.message }, 500);
  }
}