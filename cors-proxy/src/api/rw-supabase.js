import { verifyJWT } from '../utils/sign_jwt.js';
import { checkRateLimit, rateLimitResponse, deriveRateLimitIdentity } from '../utils/rate-limit.js';
import { createLogger } from '../utils/logger.js';
import { getCourseCodeFromProfile } from '../utils/course.js';

const log = createLogger('Supabase');
const JSON_HEADERS = { 'Content-Type': 'application/json' };

const BUCKET = 'fileStore';

// Helper to extract and verify access_token from request
async function requireAccessToken(request, env) {
    const authHeader = request.headers.get('authorization');
    const cookieHeader = request.headers.get('cookie');
    let accessToken = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        accessToken = authHeader.split(' ')[1];
    } else if (cookieHeader) {
        const parts = cookieHeader.split(';').map(s => s.trim());
        for (const p of parts) {
            if (p.startsWith('access_token=')) {
                accessToken = p.slice('access_token='.length);
                break;
            }
        }
    }
    if (!accessToken) {
        return { valid: false, response: new Response(JSON.stringify({ success: false, error: 'unauthenticated' }), { status: 401, headers: JSON_HEADERS }) };
    }
    try {
        const res = await verifyJWT(accessToken, env.JWT_SECRET);
        if (!res || !res.valid) {
            return { valid: false, response: new Response(JSON.stringify({ success: false, error: 'unauthenticated' }), { status: 401, headers: JSON_HEADERS }) };
        }
    } catch (e) {
        return { valid: false, response: new Response(JSON.stringify({ success: false, error: 'auth_check_failed' }), { status: 502, headers: JSON_HEADERS }) };
    }
    return { valid: true };
}

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
            log.error(`File change log insert failed (${resp.status})`, new Error(txt));
            return null;
        }
        const j = await resp.json().catch(() => null);
        return j && j[0] ? j[0] : j;
    } catch (e) {
        log.error('File change log insert error', e);
        return null;
    }
}


export async function uploadResourceToSupabase(request, env) {
    // --- Authenticate user using shared helper ---
    const auth = await requireAccessToken(request, env);
    if (!auth.valid) return auth.response;

    // --- Extract course from JWT (required, no default) ---
    const authHeader = request.headers.get('authorization');
    const cookieHeader = request.headers.get('cookie');
    let accessToken = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        accessToken = authHeader.split(' ')[1];
    } else if (cookieHeader) {
        const parts = cookieHeader.split(';').map(s => s.trim());
        for (const p of parts) {
            if (p.startsWith('access_token=')) {
                accessToken = p.slice('access_token='.length);
                break;
            }
        }
    }
    
    let course = null;
    if (accessToken) {
        try {
            const decoded = await verifyJWT(accessToken, env.JWT_SECRET);
            if (decoded && decoded.profile) {
                course = getCourseCodeFromProfile(decoded.profile);
            }
        } catch (e) {
            log.warn('Failed to extract course from JWT during upload', e);
        }
    }
    
    if (!course) {
        return new Response(JSON.stringify({ success: false, error: 'missing_or_invalid_course' }), { status: 400, headers: JSON_HEADERS });
    }

    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
        log.error('Missing Supabase configuration (URL or service role key)', null);
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
        log.error('Failed to parse form data', e);
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
                    log.warn(`Invalid MIME type for upload (${file.type}): ${file.name}`);
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
                    log.error(`Checksum lookup failed (${checkResp.status})`, new Error(t));
                    // continue to attempt upload
                }
            } catch (e) {
                log.error('Checksum lookup error', e);
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
            // include semester and unit prefix in storage path: e.g. {course}/sem-1/subject/resource_type/unit-1/safeName
            // Support "all" units: store in "unit-all" folder
            let unitSegment;
            if (unit === 'all') {
                unitSegment = 'unit-all';
            } else if (unit !== null && !Number.isNaN(Number(unit))) {
                unitSegment = `unit-${Number(unit)}`;
            } else {
                unitSegment = 'unit-1';
            }
            const objectPath = `${course}/${semester}/${subject}/${resource_type}/${unitSegment}/${safeName}`;

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

            // insert metadata row (course is embedded in storage_key path)
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
            } catch (e) { log.warn('File change log insert error', e); }

            result.id = id;
            results.push(result);
        } catch (err) {
            log.error(`File upload error: ${result.filename}`, err);
            result.error = String(err.message || err);
            results.push(result);
        }
    }
    // end for
    return new Response(JSON.stringify({ success: true, results }), { status: 201, headers: JSON_HEADERS });
}

export async function resourceStreamFromSupabase(request, env, ctx) {

    // Support both ID-based lookup (legacy) and filename-based lookup (semantic paths)
    const lookupBy = ctx?.lookupBy || 'id';
    const id = ctx?.params?.id || new URL(request.url).pathname.split('/').pop();
    const { semester, subject, unit, filename } = ctx?.params || {};

    // --- Authenticate user using shared helper ---
    const auth = await requireAccessToken(request, env);
    if (!auth.valid) return auth.response;

    // --- Extract course from JWT (required, no default) ---
    const authHeader = request.headers.get('authorization');
    const cookieHeader = request.headers.get('cookie');
    let accessToken = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        accessToken = authHeader.split(' ')[1];
    } else if (cookieHeader) {
        const parts = cookieHeader.split(';').map(s => s.trim());
        for (const p of parts) {
            if (p.startsWith('access_token=')) {
                accessToken = p.slice('access_token='.length);
                break;
            }
        }
    }
    
    // Note: Course validation not needed for resource streaming since storage_key encodes course
    // Authentication is sufficient; the stored file path defines access boundaries

    // --- Check rate limit before streaming ---
    // Derive per-user (SRN) identity when logged-in; else fall back to IP
    const rateLimitId = await deriveRateLimitIdentity(request, env);
    
    // HEAD requests should check but not consume the rate limit
    const consume = request.method !== 'HEAD';
    const limitInfo = await checkRateLimit(rateLimitId, env, { consume });
    
    if (!limitInfo.allowed) {
        log.warn(`Rate limit exceeded for ${rateLimitId}`);
        return rateLimitResponse(limitInfo);
    }
    
    // Rate limit headers to include in all responses
    const rateLimitHeaders = {
        'X-RateLimit-Limit': limitInfo.limit.toString(),
        'X-RateLimit-Remaining': limitInfo.remaining.toString(),
        'X-RateLimit-Reset': limitInfo.resetAt,
        'X-RateLimit-Violation-Count': (limitInfo.violationCount || 0).toString()
    };

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
            }
        } else {
            const t = await metaResp.text().catch(() => '<no body>');
            log.error(`Metadata fetch failed (${metaResp.status})`, new Error(t));
        }
    } catch (e) {
        log.error('Metadata request error', e);
    }

    if (!row || !row.storage_key) {
        return new Response('Not found', { status: 404, headers: rateLimitHeaders });
    }

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
                    log.error(`HEAD request failed (${headResp.status})`, new Error(txt));
                    return new Response(txt, { status: headResp.status, headers: rateLimitHeaders });
                }

                // Build response headers for HEAD: include content-type, length, and advertise range support
                const respHeaders = { ...rateLimitHeaders };
                const ct = headResp.headers.get('content-type') || row.content_type || 'application/octet-stream';
                respHeaders['Content-Type'] = ct;
                const len = headResp.headers.get('content-length');
                if (len) respHeaders['Content-Length'] = len;
                // Explicitly advertise byte-range support so PDF.js can issue Range requests
                respHeaders['Accept-Ranges'] = 'bytes';

                return new Response(null, { status: 200, headers: respHeaders });
            } catch (e) {
                log.error('HEAD request processing error', e);
                return new Response(JSON.stringify({ success: false, error: 'head_request_failed' }), { 
                    status: 502, 
                    headers: { ...JSON_HEADERS, ...rateLimitHeaders } 
                });
            }
        }

    // get a signed URL from Supabase Storage and proxy the resource through the worker
    try {
        // Proxy via service-role authenticated object GET to avoid signed-url issues
        const supaHeaders = { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, apikey: `${env.SUPABASE_SERVICE_ROLE_KEY}` };
        const objectUrl = `${env.SUPABASE_URL.replace(/\/+$/, '')}/storage/v1/object/${encodeURIComponent(BUCKET)}/${encodeURIComponent(row.storage_key)}`;

        const fetchHeaders = { ...supaHeaders };
        const range = request.headers.get('range');
        if (range) fetchHeaders['Range'] = range;

        const upstream = await fetch(objectUrl, { method: 'GET', headers: fetchHeaders });
        if (!upstream.ok && upstream.status !== 206) {
            const txt = await upstream.text().catch(() => '<no body>');
            log.error(`File fetch failed (${upstream.status})`, new Error(txt));
            return new Response(txt, { 
                status: upstream.status, 
                headers: { 'Content-Type': 'text/plain', ...rateLimitHeaders } 
            });
        }

        const respHeaders = { ...rateLimitHeaders };
        const copyHeaders = ['content-type', 'content-length', 'content-disposition', 'accept-ranges', 'cache-control', 'last-modified', 'etag'];
        for (const h of copyHeaders) {
            const v = upstream.headers.get(h);
            if (v) respHeaders[h] = v;
        }
        // Ensure Accept-Ranges always advertised so PDF.js can attempt partial loading
        if (!respHeaders['accept-ranges']) {
            respHeaders['Accept-Ranges'] = 'bytes';
        }
        // Debug header to detect when full body was delivered without Range request
        const rangeRequested = request.headers.get('range');
        if (!rangeRequested && respHeaders['content-length']) {
            respHeaders['X-Debug-Full-Fetch'] = 'true';
        }

        return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
    } catch (e) {
        log.error('File proxy error', e);
        return new Response(JSON.stringify({ success: false, error: 'sign_or_proxy_error' }), { 
            status: 502, 
            headers: { ...JSON_HEADERS, ...rateLimitHeaders } 
        });
    }
}