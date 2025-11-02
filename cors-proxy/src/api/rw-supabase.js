import { getCorsHeaders } from '../utils/cors.js';

const BUCKET = 'fileStore';

// Try multiple ways to obtain a signed URL from Supabase Storage. Supabase deployments
// differ in accepted query params / methods (GET vs POST). This helper attempts
// the most common forms and returns the parsed body ({ signedURL }) on success.
async function getSignedUrl(env, bucket, storageKey) {
    const base = env.SUPABASE_URL.replace(/\/+$/, '') + `/storage/v1/object/sign/${encodeURIComponent(bucket)}/${encodeURIComponent(storageKey)}`;
    const headers = { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, apikey: `${env.SUPABASE_SERVICE_ROLE_KEY}` };

    async function tryParseJsonOrText(res, tag) {
        try {
            return await res.json();
        } catch (e) {
            const txt = await res.text().catch(() => '');
            if (txt) {
                    // If the endpoint returns a raw URL string (not JSON), accept that
                if (/^https?:\/\//i.test(txt) || txt.startsWith('/')) {
                    return { signedURL: txt };
                }
                try { return JSON.parse(txt); } catch (e2) { console.error(`getSignedUrl: ${tag} returned non-json body`, txt); }
            } else {
                console.error(`getSignedUrl: ${tag} returned empty body`);
            }
            return null;
        }
    }

    // Try POST with camelCase expiresIn first (some Supabase variants expect this)
    try {
        const r = await fetch(base, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 60 }) });
        if (r.ok) {
            const parsed = await tryParseJsonOrText(r, 'r_post_expiresIn');
            if (parsed) return parsed;
        } else {
            const t = await r.text().catch(() => '');
            console.error('getSignedUrl: r_post_expiresIn failed', r.status, t);
        }
    } catch (e) {
        console.error('getSignedUrl: r_post_expiresIn error', e);
    }

    // Try GET with expiresIn (camelCase) query
    try {
        const u = `${base}?expiresIn=60`;
        const r = await fetch(u, { headers });
        if (r.ok) {
            const parsed = await tryParseJsonOrText(r, 'r_get_expiresIn');
            if (parsed) return parsed;
        } else {
            const t = await r.text().catch(() => '');
            console.error('getSignedUrl: r_get_expiresIn failed', r.status, t);
        }
    } catch (e) {
        console.error('getSignedUrl: r_get_expiresIn error', e);
    }

    // Try GET with token & expiresIn
    try {
        const u = `${base}?token=${encodeURIComponent(env.SUPABASE_SERVICE_ROLE_KEY)}&expiresIn=60`;
        const r = await fetch(u, { headers });
        if (r.ok) {
            const parsed = await tryParseJsonOrText(r, 'r_get_token_expiresIn');
            if (parsed) return parsed;
        } else {
            const t = await r.text().catch(() => '');
            console.error('getSignedUrl: r_get_token_expiresIn failed', r.status, t);
        }
    } catch (e) {
        console.error('getSignedUrl: r_get_token_expiresIn error', e);
    }

    // Fallbacks: try older forms
    try {
        const u1 = `${base}?expires_in=60`;
        const r1 = await fetch(u1, { headers });
        if (r1.ok) {
            const parsed = await tryParseJsonOrText(r1, 'r1_get_expires_in');
            if (parsed) return parsed;
        } else {
            const txt = await r1.text().catch(() => '');
            console.error('getSignedUrl: r1 failed', r1.status, txt);
        }
    } catch (e) {
        console.error('getSignedUrl: r1 error', e);
    }

    try {
        const u2 = `${base}?token=${encodeURIComponent(env.SUPABASE_SERVICE_ROLE_KEY)}&expires_in=60`;
        const r2 = await fetch(u2, { headers });
        if (r2.ok) {
            const parsed = await tryParseJsonOrText(r2, 'r2_get_token_expires_in');
            if (parsed) return parsed;
        } else {
            const txt = await r2.text().catch(() => '');
            console.error('getSignedUrl: r2 failed', r2.status, txt);
        }
    } catch (e) {
        console.error('getSignedUrl: r2 error', e);
    }

    // Try POST with snake_case expires_in as a last attempt
    try {
        const r3 = await fetch(base, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ expires_in: 60 }) });
        if (r3.ok) {
            const parsed = await tryParseJsonOrText(r3, 'r3_post_expires_in');
            if (parsed) return parsed;
        } else {
            const txt = await r3.text().catch(() => '');
            console.error('getSignedUrl: r3 failed', r3.status, txt);
        }
    } catch (e) {
        console.error('getSignedUrl: r3 error', e);
    }

    return null;
}

function resolveSignedUrl(body, env) {
    if (!body) return null;
    const cand = body.signedURL || body.signedUrl || body.url || body.path || null;
    if (!cand) return null;
    if (/^https?:\/\//i.test(cand)) return cand;
    // cand is relative: normalize to full Supabase storage URL
    const base = env.SUPABASE_URL ? env.SUPABASE_URL.replace(/\/+$/, '') : '';
    if (!base) return cand; // give up, return whatever
    if (cand.startsWith('/storage/v1')) return base + cand;
    if (cand.startsWith('/object')) return base + '/storage/v1' + cand;
    if (cand.startsWith('/')) return base + '/storage/v1' + cand;
    // If the sign endpoint returned a separate token field, attach it as a query param
    let url = base + '/storage/v1/' + cand;
    const token = body.token || body.Token || body.signedToken || body.tokenValue || null;
    if (token) {
        // preserve existing query string
        url += (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);
    }
    return url;
}

function maskUrlForLogs(url) {
    try {
        const u = new URL(url);
        if (u.searchParams.has('token')) {
            u.searchParams.set('token', 'REDACTED');
        }
        // mask any param that looks like a jwt
        for (const [k, v] of u.searchParams.entries()) {
            if (typeof v === 'string' && v.length > 100) {
                u.searchParams.set(k, 'REDACTED');
            }
        }
        return u.toString();
    } catch (e) {
        return url.replace(/([?&]token=)[^&]*/i, '$1REDACTED');
    }
}

export async function uploadResourceToSupabase(request, env) {
    const cors = getCorsHeaders(request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
        console.error('uploadResourceToSupabase: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured');
        return new Response(JSON.stringify({ success: false, error: 'server_misconfigured' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...cors },
        });
    }

    const contentType = request.headers.get('content-type') || '';
    if (!contentType.startsWith('multipart/')) {
        return new Response(JSON.stringify({ success: false, error: 'invalid_content_type' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...cors },
        });
    }

    let form;
    try {
        form = await request.formData();
    } catch (e) {
        console.error('failed to parse formData', e);
        return new Response(JSON.stringify({ success: false, error: 'invalid_form' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...cors },
        });
    }

    // allow multiple files under field name "file"
    const files = form.getAll('file') || [];
    const subject = form.get('subject');
    const resource_type = form.get('resource_type');
    const unit = form.get('unit') ? Number(form.get('unit')) : null;
    // get all linkTitle entries (may be empty array)
    const linkTitles = form.getAll('linkTitle') || [];

    if (!files.length || !subject || !resource_type) {
        return new Response(JSON.stringify({ success: false, error: 'missing_fields' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...cors },
        });
    }

    const results = [];

    // helper to call Supabase REST with service role headers
    const supaHeaders = {
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: `${env.SUPABASE_SERVICE_ROLE_KEY}`,
    };

    for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
        const file = files[fileIndex];
        const result = { filename: file?.name || null, id: null, existing: false, error: null };
        try {
            // read bytes and compute checksum
            let ab;
            try {
                ab = await file.arrayBuffer();
            } catch (e) {
                throw new Error('read_file_failed');
            }

            const hashBuf = await crypto.subtle.digest('SHA-256', ab);
            const checksum = Array.from(new Uint8Array(hashBuf)).map((b) => b.toString(16).padStart(2, '0')).join('');

            // check existing by checksum
            try {
                const checkUrl = `${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/fileStore?select=id&checksum=eq.${checksum}`;
                const checkResp = await fetch(checkUrl, { headers: supaHeaders });
                if (checkResp.ok) {
                    const arr = await checkResp.json().catch(() => []);
                    if (Array.isArray(arr) && arr.length) {
                        result.id = arr[0].id;
                        result.existing = true;
                        results.push(result);
                        continue; // next file
                    }
                } else {
                    const t = await checkResp.text().catch(() => '<no body>');
                    console.error('supabase checksum lookup failed', checkResp.status, t);
                    // continue to attempt upload
                }
            } catch (e) {
                console.error('supabase checksum lookup error', e);
                // continue to attempt upload
            }

            // build storage key: subject/resource_type/checksum + ext
            const id = crypto && crypto.randomUUID ? crypto.randomUUID() : `res-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const filename = file.name || `${id}.pdf`;
            const extMatch = filename.match(/(\.[^./\\?]+)$/);
            const ext = extMatch ? extMatch[1] : '';
            const objectPath = `${subject}/${resource_type}/${checksum}${ext}`;

            // upload bytes
            const uploadUrl = `${env.SUPABASE_URL.replace(/\/+$/, '')}/storage/v1/object/${encodeURIComponent(BUCKET)}/${encodeURIComponent(objectPath)}`;
            const uploadResp = await fetch(uploadUrl, {
                method: 'PUT',
                headers: {
                    ...supaHeaders,
                    'Content-Type': file.type || 'application/pdf',
                },
                body: new Uint8Array(ab),
            });

            if (!uploadResp.ok) {
                const txt = await uploadResp.text().catch(() => '<no body>');
                throw new Error(`upload_failed: ${uploadResp.status} ${txt}`);
            }

            // determine per-file link title (from form linkTitle entries, fallback to filename)
            let link_title = null;
            if (linkTitles && linkTitles.length > fileIndex) {
                const v = linkTitles[fileIndex];
                if (typeof v === 'string' && v.trim().length > 0) link_title = v.trim();
            }
            if (!link_title) link_title = filename;

            // insert metadata row
            const supaUrl = `${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/fileStore`;
            const body = [{
                id, subject, resource_type, unit, filename,
                storage_key: objectPath, content_type: file.type || 'application/pdf', size: file.size || null, checksum, uploaded_by: null,
                link_title
            }];
            const insertResp = await fetch(supaUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...supaHeaders,
                    Prefer: 'return=representation',
                },
                body: JSON.stringify(body),
            });

            if (!insertResp.ok) {
                const t = await insertResp.text().catch(() => '<no body>');
                // optionally cleanup uploaded object here
                throw new Error(`metadata_insert_failed: ${insertResp.status} ${t}`);
            }

            result.id = id;
            results.push(result);
        } catch (err) {
            console.error('file upload error', result.filename, err);
            result.error = String(err.message || err);
            results.push(result);
        }
    }
    // end for
    return new Response(JSON.stringify({ success: true, results }), { status: 201, headers: { 'Content-Type': 'application/json', ...cors } });
}

export async function resourceStreamFromSupabase(request, env, ctx) {
    const cors = getCorsHeaders(request);

    const id = ctx?.params?.id || new URL(request.url).pathname.split('/').pop();

    let row = null;
    try {
        const metaUrl = `${env.SUPABASE_URL.replace(
            /\/+$/,
            ''
        )}/rest/v1/fileStore?select=storage_key,content_type,filename&id=eq.${encodeURIComponent(id)}`;
        const metaResp = await fetch(metaUrl, {
            headers: { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, apikey: `${env.SUPABASE_SERVICE_ROLE_KEY}` },
        });
        if (metaResp.ok) {
            const arr = await metaResp.json().catch(() => []);
            if (Array.isArray(arr) && arr.length) row = arr[0];
        } else {
            const t = await metaResp.text().catch(() => '<no body>');
            console.error('supabase metadata fetch failed', metaResp.status, t);
        }
    } catch (e) {
        console.error('supabase metadata request error', e);
    }

    if (!row || !row.storage_key) return new Response('Not found', { status: 404, headers: cors });

        if (request.method === 'HEAD') {
            try {
                // Use service-role auth to directly fetch object metadata from Supabase Storage
                const supaHeaders = { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, apikey: `${env.SUPABASE_SERVICE_ROLE_KEY}` };
                const objectUrl = `${env.SUPABASE_URL.replace(/\/+$/, '')}/storage/v1/object/${encodeURIComponent(BUCKET)}/${encodeURIComponent(
                    row.storage_key
                )}`;

                const headResp = await fetch(objectUrl, { method: 'HEAD', headers: supaHeaders });
                if (!headResp.ok) {
                    const txt = await headResp.text().catch(() => '<no body>');
                    console.error('upstream object HEAD failed', headResp.status, txt);
                    return new Response(txt, { status: headResp.status, headers: cors });
                }

                // Build response headers for HEAD: include content-type and length if present
                const respHeaders = { ...cors };
                const ct = headResp.headers.get('content-type') || row.content_type || 'application/octet-stream';
                respHeaders['Content-Type'] = ct;
                const len = headResp.headers.get('content-length');
                if (len) respHeaders['Content-Length'] = len;

                return new Response(null, { status: 200, headers: respHeaders });
            } catch (e) {
                console.error('error performing HEAD against storage object', e);
                return new Response(JSON.stringify({ success: false, error: 'head_request_failed' }), {
                    status: 502,
                    headers: { 'Content-Type': 'application/json', ...cors },
                });
            }
        }

    // get a signed URL from Supabase Storage and proxy the resource through the worker
    try {
            try {
                // Proxy via service-role authenticated object GET to avoid signed-url issues
                const supaHeaders = { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, apikey: `${env.SUPABASE_SERVICE_ROLE_KEY}` };
                const objectUrl = `${env.SUPABASE_URL.replace(/\/+$/, '')}/storage/v1/object/${encodeURIComponent(BUCKET)}/${encodeURIComponent(
                    row.storage_key
                )}`;

                const fetchHeaders = { ...supaHeaders };
                const range = request.headers.get('range');
                if (range) fetchHeaders['Range'] = range;

                const upstream = await fetch(objectUrl, { method: 'GET', headers: fetchHeaders });
                if (!upstream.ok && upstream.status !== 206) {
                    const txt = await upstream.text().catch(() => '<no body>');
                    console.error('upstream object fetch failed', upstream.status, txt);
                    return new Response(txt, { status: upstream.status, headers: { ...cors, 'Content-Type': 'text/plain' } });
                }

                const respHeaders = { ...cors };
                const copyHeaders = ['content-type', 'content-length', 'content-disposition', 'accept-ranges', 'cache-control', 'last-modified', 'etag'];
                for (const h of copyHeaders) {
                    const v = upstream.headers.get(h);
                    if (v) respHeaders[h] = v;
                }

                return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
            } catch (e) {
                console.error('error obtaining signed url or proxying', e);
                return new Response(JSON.stringify({ success: false, error: 'sign_or_proxy_error' }), {
                    status: 502,
                    headers: { 'Content-Type': 'application/json', ...cors },
                });
            }
    } catch (e) {
        console.error('error obtaining signed url or proxying', e);
        return new Response(JSON.stringify({ success: false, error: 'sign_or_proxy_error' }), {
            status: 502,
            headers: { 'Content-Type': 'application/json', ...cors },
        });
    }
}