import { verifyJWT } from '../utils/sign_jwt.js';

// Centralized CORS applied at the worker level; only specify content-type locally.
const JSON_HEADERS = { 'Content-Type': 'application/json' };

const BUCKET = 'fileStore';

// helper: write a file change log row into Supabase via REST API.
// Table name may be configured via env.FILE_CHANGE_LOG_TABLE (default: file_change_log)
async function insertFileChangeLog(env, supaHeaders, entry) {
    // entry: { action, storage_key, filename, metadata_id, performed_by, details }
    try {
        const table = env.FILE_CHANGE_LOG_TABLE || 'file_change_log';
        const url = `${env.SUPABASE_URL.replace(/\/+$/,'')}/rest/v1/${encodeURIComponent(table)}`;
        const body = [ Object.assign({}, entry) ];
        const resp = await fetch(url, { method: 'POST', headers: { ...supaHeaders, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(body) });
        if (!resp.ok) {
            const txt = await resp.text().catch(() => '<no body>');
            console.error('insertFileChangeLog failed', resp.status, txt);
            return null;
        }
        const j = await resp.json().catch(() => null);
        return j && j[0] ? j[0] : j;
    } catch (e) {
        console.error('insertFileChangeLog error', e);
        return null;
    }
}

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

    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
        console.error('uploadResourceToSupabase: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured');
        return new Response(JSON.stringify({ success: false, error: 'server_misconfigured' }), { status: 500, headers: JSON_HEADERS });
    }

    const contentType = request.headers.get('content-type') || '';
    if (!contentType.startsWith('multipart/')) {
        return new Response(JSON.stringify({ success: false, error: 'invalid_content_type' }), { status: 400, headers: JSON_HEADERS });
    }

    let form;
    try {
        form = await request.formData();
    } catch (e) {
        console.error('failed to parse formData', e);
        return new Response(JSON.stringify({ success: false, error: 'invalid_form' }), { status: 400, headers: JSON_HEADERS });
    }

    // allow multiple files under field name "file"
    const files = form.getAll('file') || [];
    const subject = form.get('subject');
    const resource_type = form.get('resource_type');
    // Support "all" units (applicable to all units) in addition to numeric unit values
    const rawUnit = form.get('unit');
    const unit = (rawUnit === 'all') ? 'all' : (rawUnit ? Number(rawUnit) : null);
    // normalize semester (accepted values from form: e.g. "Semester-1", "Sem-1", "1", "sem-1")
    const rawSemester = form.get('semester');
    let semester = 'sem-1';
    if (rawSemester) {
        let s = String(rawSemester).toLowerCase().trim();
        s = s.replace(/\s+/g, '-');
        // convert "semester-1" -> "sem-1"
        s = s.replace(/^semester-?/, 'sem-');
        // if user passed just a number like "1", prefix sem-
        if (/^\d+$/.test(s)) s = `sem-${s}`;
        // ensure only allowed chars
        s = s.replace(/[^a-z0-9\-]+/g, '');
        if (s) semester = s;
    }
    // get all linkTitle entries (may be empty array)
    const linkTitles = form.getAll('linkTitle') || [];
    const performed_by = form.get('performed_by') || null;

    if (!files.length || !subject || !resource_type) {
        return new Response(JSON.stringify({ success: false, error: 'missing_fields' }), { status: 400, headers: JSON_HEADERS });
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

            // Server-side PDF validation: ensure the uploaded bytes look like a PDF
            try {
                const u8 = new Uint8Array(ab || []);
                // Quick MIME hint check (may be empty or spoofed) - not authoritative
                if (file.type && file.type !== 'application/pdf') {
                    // Log a warning but still validate by magic bytes below
                    console.warn('upload: file.type is not application/pdf', file.type, file.name);
                }

                // Look for the ASCII signature "%PDF-" within the first 1KB
                const pattern = [0x25, 0x50, 0x44, 0x46, 0x2D]; // '%PDF-'
                const maxScan = Math.min(u8.length, 1024);
                let found = false;
                for (let i = 0; i + pattern.length <= maxScan; i++) {
                    let ok = true;
                    for (let j = 0; j < pattern.length; j++) {
                        if (u8[i + j] !== pattern[j]) { ok = false; break; }
                    }
                    if (ok) { found = true; break; }
                }
                if (!found) {
                    throw new Error('invalid_pdf_file');
                }
            } catch (e) {
                throw new Error(e.message || 'invalid_pdf_file');
            }

            const hashBuf = await crypto.subtle.digest('SHA-256', ab);
            const checksum = Array.from(new Uint8Array(hashBuf)).map((b) => b.toString(16).padStart(2, '0')).join('');

            // check existing by checksum
            try {
                    // check existing by checksum for the same semester only (avoid cross-semester collisions)
                    const checkUrl = `${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/fileStore?select=id&checksum=eq.${checksum}&semester=eq.${encodeURIComponent(semester)}`;
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

            // build storage key: prefer preserving the original filename (sanitized)
            // so uploaded files retain the same name users see in the upload form.
            // We still computed checksum above for dedup checks and metadata.
            const id = crypto && crypto.randomUUID ? crypto.randomUUID() : `res-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const origName = file.name || `${id}.pdf`;
            // expose filename variable for metadata insertion
            const filename = origName;
            // sanitize filename to avoid directory traversal and remove path chars
            const safeName = String(origName).replace(/[\\\/]+/g, '_').replace(/^[.\s]+/, '').slice(0, 240);
            // include semester and unit prefix in storage path: e.g. sem-1/subject/resource_type/unit-1/safeName
            // Support "all" units: store in "unit-all" folder
            let unitSegment;
            if (unit === 'all') {
                unitSegment = 'unit-all';
            } else if (unit !== null && !Number.isNaN(Number(unit))) {
                unitSegment = `unit-${Number(unit)}`;
            } else {
                unitSegment = 'unit-1';
            }
            const objectPath = `${semester}/${subject}/${resource_type}/${unitSegment}/${safeName}`;

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
                id, semester, subject, resource_type, unit, filename,
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

            // Log create event to file change log table (best-effort)
            try {
                // include performing user if provided by client
                await insertFileChangeLog(env, supaHeaders, {
                    action: 'create',
                    storage_key: objectPath,
                    filename: filename,
                    metadata_id: id,
                    performed_by: performed_by || null,
                    details: { resource_type, subject, unit }
                });
            } catch (e) { console.warn('file change log insert error', e); }

            result.id = id;
            results.push(result);
        } catch (err) {
            console.error('file upload error', result.filename, err);
            result.error = String(err.message || err);
            results.push(result);
        }
    }
    // end for
    return new Response(JSON.stringify({ success: true, results }), { status: 201, headers: JSON_HEADERS });
}

// Mint a short-lived signed stream token for an authenticated user.
// Expected: POST JSON { id: "<resource-id>" , ttl: seconds }
// Authentication: caller must present an Authorization: Bearer <access_token>
// that can be validated against Supabase Auth (/auth/v1/user). The worker
// will verify the user then sign a token with STREAM_SIGNING_SECRET.
export async function mintStreamToken(request, env) {

    if (!env.STREAM_SIGNING_SECRET) {
        console.error('mintStreamToken: STREAM_SIGNING_SECRET not configured');
        return new Response(JSON.stringify({ success: false, error: 'server_misconfigured' }), { status: 500, headers: JSON_HEADERS });
    }

    if (request.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'method_not_allowed' }), { status: 405, headers: JSON_HEADERS });
    }

    let body = null;
    try {
        body = await request.json();
    } catch (e) {
    return new Response(JSON.stringify({ success: false, error: 'invalid_json' }), { status: 400, headers: JSON_HEADERS });
    }

    const id = body && body.id ? String(body.id) : '*';
    const ttl = Number(body && body.ttl) || 600; // default 10 minutes

    // Verify user: validate JWT issued by our login flow. Accept either
    // Authorization: Bearer <jwt> or access_token cookie. Use verifyJWT with
    // env.JWT_SECRET so we don't call Supabase for auth validation.
    const authHeader = request.headers.get('authorization');
    const cookieHeader = request.headers.get('cookie');
    if (!authHeader && !cookieHeader) return new Response(JSON.stringify({ success: false, error: 'unauthenticated' }), { status: 401, headers: JSON_HEADERS });

    try {
        let token = null;
        if (authHeader && authHeader.startsWith('Bearer ')) token = authHeader.split(' ')[1];
        if (!token && cookieHeader) {
            // parse cookies to find access_token
            const parts = cookieHeader.split(';').map(s => s.trim());
            for (const p of parts) {
                if (p.startsWith('access_token=')) {
                    token = p.slice('access_token='.length);
                    break;
                }
            }
        }
    if (!token) return new Response(JSON.stringify({ success: false, error: 'unauthenticated' }), { status: 401, headers: JSON_HEADERS });

        const res = await verifyJWT(token, env.JWT_SECRET);
        if (!res || !res.valid) {
            console.error('mintStreamToken: jwt verify failed', res && res.reason);
            return new Response(JSON.stringify({ success: false, error: 'unauthenticated' }), { status: 401, headers: JSON_HEADERS });
        }
        // res.payload available if you need profile info
    } catch (e) {
        console.error('mintStreamToken: user validation error', e);
    return new Response(JSON.stringify({ success: false, error: 'auth_check_failed' }), { status: 502, headers: JSON_HEADERS });
    }

    // Create payload and sign it using HMAC-SHA256 with STREAM_SIGNING_SECRET
    try {
        const payload = JSON.stringify({ id, exp: Math.floor(Date.now() / 1000) + ttl });

        // encode payload base64url
        const b64payload = btoa(unescape(encodeURIComponent(payload))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

        const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.STREAM_SIGNING_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
        const bytes = new Uint8Array(sigBuf);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const b64sig = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

        const token = `${b64payload}.${b64sig}`;
    return new Response(JSON.stringify({ success: true, token }), { status: 200, headers: JSON_HEADERS });
    } catch (e) {
        console.error('mintStreamToken: signing error', e);
    return new Response(JSON.stringify({ success: false, error: 'signing_failed' }), { status: 500, headers: JSON_HEADERS });
    }
}

export async function resourceStreamFromSupabase(request, env, ctx) {

    // Support both ID-based lookup (legacy) and filename-based lookup (semantic paths)
    const lookupBy = ctx?.lookupBy || 'id';
    const id = ctx?.params?.id || new URL(request.url).pathname.split('/').pop();
    const { semester, subject, unit, filename } = ctx?.params || {};

    // --- Signed token verification to prevent unauthenticated access ---
    // Token may be provided as ?token=... or Authorization: Bearer <token>
    function base64UrlFromArrayBuffer(buf) {
        const bytes = new Uint8Array(buf);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        // btoa is available in Workers
        return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    function base64UrlDecodeToString(str) {
        // base64url -> base64
        str = str.replace(/-/g, '+').replace(/_/g, '/');
        while (str.length % 4) str += '=';
        const bin = atob(str);
        // Convert binary string to utf-8 string
        try { return decodeURIComponent(escape(bin)); } catch (e) { return bin; }
    }

    async function verifySignedToken(token, expectedId, env) {
        if (!token) return false;
        const secret = env.STREAM_SIGNING_SECRET;
        if (!secret) {
            console.error('verifySignedToken: STREAM_SIGNING_SECRET not configured');
            return false;
        }
        const parts = token.split('.');
        if (parts.length !== 2) return false;
        const [b64payload, b64sig] = parts;
        let payloadStr;
        try {
            payloadStr = base64UrlDecodeToString(b64payload);
        } catch (e) {
            return false;
        }
        let payload;
        try {
            payload = JSON.parse(payloadStr);
        } catch (e) {
            return false;
        }
        // check expiry (payload.exp in seconds)
        if (payload.exp && Date.now() / 1000 > payload.exp) return false;
        // check id matches or wildcard
        if (payload.id && payload.id !== '*' && String(payload.id) !== String(expectedId)) return false;
        try {
            const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
            const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadStr));
            const computed = base64UrlFromArrayBuffer(sigBuf);
            return computed === b64sig;
        } catch (e) {
            console.error('verifySignedToken error', e);
            return false;
        }
    }

    // Decode payload from a base64url(token) without verifying signature.
    function decodeSignedPayload(token) {
        if (!token) return null;
        const parts = token.split('.');
        if (parts.length !== 2) return null;
        try {
            const payloadStr = base64UrlDecodeToString(parts[0]);
            return JSON.parse(payloadStr);
        } catch (e) {
            return null;
        }
    }

    // Create a stream token (id or '*' for wildcard) with TTL seconds
    async function createStreamToken(id = '*', ttl = 600, env) {
        const payload = JSON.stringify({ id, exp: Math.floor(Date.now() / 1000) + ttl });
        const b64payload = btoa(unescape(encodeURIComponent(payload))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.STREAM_SIGNING_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
        const bytes = new Uint8Array(sigBuf);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const b64sig = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        return `${b64payload}.${b64sig}`;
    }

    const urlObj = new URL(request.url);
    const providedToken = urlObj.searchParams.get('token') || (request.headers.get('authorization') || '').split(' ')[1] || null;
    if (!env.STREAM_SIGNING_SECRET) {
        console.error('resourceStreamFromSupabase: STREAM_SIGNING_SECRET not set');
        return new Response(JSON.stringify({ success: false, error: 'server_misconfigured' }), { status: 500, headers: JSON_HEADERS });
    }
    // Token verification will happen after metadata fetch for both lookup types
    // (we need the resource ID for filename-based lookups)

    let row = null;
    try {
        let metaUrl;
        if (lookupBy === 'filename') {
            // Query by semantic path components
            const cleanSemester = semester || '';
            const cleanSubject = subject || '';
            const cleanUnit = unit || '';
            // filename may arrive URL-encoded from the route; decode once before encoding into query
            const cleanFilename = filename ? decodeURIComponent(filename) : '';
            const filters = [
                `semester=eq.${encodeURIComponent(cleanSemester)}`,
                `subject=eq.${encodeURIComponent(cleanSubject)}`,
                `unit=eq.${encodeURIComponent(cleanUnit)}`,
                `filename=eq.${encodeURIComponent(cleanFilename)}`
            ].join('&');
            metaUrl = `${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/fileStore?select=id,storage_key,content_type,filename&${filters}`;
        } else {
            // Legacy ID-based lookup
            metaUrl = `${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/fileStore?select=storage_key,content_type,filename&id=eq.${encodeURIComponent(id)}`;
        }
        
        const metaResp = await fetch(metaUrl, {
            headers: { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, apikey: `${env.SUPABASE_SERVICE_ROLE_KEY}` },
        });
        if (metaResp.ok) {
            const arr = await metaResp.json().catch(() => []);
            if (Array.isArray(arr) && arr.length) {
                row = arr[0];
                // For filename-based lookup, set id from the result for token verification
                if (lookupBy === 'filename' && row.id) {
                    // Update id variable for token validation
                    // Note: We need to reassign through a different approach since id is const
                    // For now, we'll use row.id in token verification below
                }
            }
        } else {
            const t = await metaResp.text().catch(() => '<no body>');
            console.error('supabase metadata fetch failed', metaResp.status, t);
        }
    } catch (e) {
        console.error('supabase metadata request error', e);
    }

    if (!row || !row.storage_key) return new Response('Not found', { status: 404 });

    // --- Token verification (works for both ID-based and filename-based lookups) ---
    const resourceId = row.id || id;
    let tokenValid = await verifySignedToken(providedToken, resourceId, env);
    let freshlyMintedToken = null;
    
    if (!tokenValid) {
        // If token is missing or invalid, check if it is merely expired. If
        // expired and the caller is authenticated (cookie or Authorization
        // JWT), mint a fresh wildcard token and allow access.
        const decoded = decodeSignedPayload(providedToken);
        const now = Math.floor(Date.now() / 1000);
        const isExpired = decoded && decoded.exp && now > decoded.exp;

        // Try to validate session via JWT (access_token cookie or Authorization header)
        const authHeader = request.headers.get('authorization');
        const cookieHeader = request.headers.get('cookie');
        let sessionToken = null;
        try {
            if (authHeader && authHeader.startsWith('Bearer ')) sessionToken = authHeader.split(' ')[1];
            if (!sessionToken && cookieHeader) {
                const parts = cookieHeader.split(';').map(s => s.trim());
                for (const p of parts) {
                    if (p.startsWith('access_token=')) { sessionToken = p.slice('access_token='.length); break; }
                }
            }
        } catch (e) {
            sessionToken = null;
        }

        let sessionValid = false;
        if (sessionToken) {
            try {
                const res = await verifyJWT(sessionToken, env.JWT_SECRET);
                if (res && res.valid) sessionValid = true;
            } catch (e) {
                sessionValid = false;
            }
        }

        if (sessionValid) {
            // Mint a fresh wildcard token for the client to use; include it in
            // the response headers so the client can update session storage.
            try {
                freshlyMintedToken = await createStreamToken('*', 600, env);
                tokenValid = true;
            } catch (e) {
                console.error('failed to mint fresh stream token', e);
            }
        } else {
            // not valid session and token not valid -> unauthorized
            return new Response(JSON.stringify({ success: false, error: 'unauthorized' }), { status: 401, headers: JSON_HEADERS });
        }
    }
    // --- end token verification ---

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
                    return new Response(txt, { status: headResp.status });
                }

                // Build response headers for HEAD: include content-type, length, and advertise range support
                const respHeaders = {};
                const ct = headResp.headers.get('content-type') || row.content_type || 'application/octet-stream';
                respHeaders['Content-Type'] = ct;
                const len = headResp.headers.get('content-length');
                if (len) respHeaders['Content-Length'] = len;
                // Explicitly advertise byte-range support so PDF.js can issue Range requests
                respHeaders['Accept-Ranges'] = 'bytes';

                return new Response(null, { status: 200, headers: respHeaders });
            } catch (e) {
                console.error('error performing HEAD against storage object', e);
                return new Response(JSON.stringify({ success: false, error: 'head_request_failed' }), { status: 502, headers: JSON_HEADERS });
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
                    return new Response(txt, { status: upstream.status, headers: { 'Content-Type': 'text/plain' } });
                }

                const respHeaders = {};
                const copyHeaders = ['content-type', 'content-length', 'content-disposition', 'accept-ranges', 'cache-control', 'last-modified', 'etag'];
                for (const h of copyHeaders) {
                    const v = upstream.headers.get(h);
                    if (v) respHeaders[h] = v;
                }

                // attach freshly minted token (if any) so clients can refresh
                if (freshlyMintedToken) {
                    respHeaders['X-Stream-Token'] = freshlyMintedToken;
                }
                return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
            } catch (e) {
                console.error('error obtaining signed url or proxying', e);
                return new Response(JSON.stringify({ success: false, error: 'sign_or_proxy_error' }), { status: 502, headers: JSON_HEADERS });
            }
    } catch (e) {
        console.error('error obtaining signed url or proxying', e);
        return new Response(JSON.stringify({ success: false, error: 'sign_or_proxy_error' }), { status: 502, headers: JSON_HEADERS });
    }
}