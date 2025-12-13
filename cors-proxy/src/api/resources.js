/**
 * GET /api/resources - Get all resources with optional filters
 * Query params:
 *   - course: filter by course code (e.g., "CA") - if not provided, uses JWT profile course
 *   - semester: filter by semester (e.g., "sem-1")
 *   - subject: filter by subject (e.g., "cfp")
 *   - resource_type: filter by type (e.g., "Notes")
 *   - limit: max number of results (default: 1000)
 *   - offset: pagination offset (default: 0)
 */
import { checkRateLimit, deriveRateLimitIdentity } from '../utils/rate-limit.js';
import { createLogger } from '../utils/logger.js';
import { getCourseCodeFromProfile } from '../utils/course.js';
import { verifyJWT } from '../utils/sign_jwt.js';

const log = createLogger('Resources');

async function getCourseFromRequest(request, env) {
    // Try to extract course from request query params first
    const url = new URL(request.url);
    let course = url.searchParams.get('course');
    
    if (course) return course;

    // Fallback: extract from JWT in request
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
    
    if (accessToken) {
        try {
            const decoded = await verifyJWT(accessToken, env.JWT_SECRET);
            if (decoded && decoded.profile) {
                course = getCourseCodeFromProfile(decoded.profile);
            }
        } catch (e) {
            log.warn('Failed to extract course from JWT in resources.js', e);
        }
    }

    return course || null;
}

export async function getResources(request, env) {
    try {
        const url = new URL(request.url);
        const course = await getCourseFromRequest(request, env);
        
        // Course is optional for listing—storage_key encodes which course owns each file
        // But we can filter by course if provided for optimization
        const semester = url.searchParams.get('semester');
        const subject = url.searchParams.get('subject');
        const resourceType = url.searchParams.get('resource_type');
        const limit = parseInt(url.searchParams.get('limit')) || 1000;
        const offset = parseInt(url.searchParams.get('offset')) || 0;

        const base = env.SUPABASE_URL.replace(/\/+$/, '');
        const headers = {
            Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            apikey: env.SUPABASE_SERVICE_ROLE_KEY,
            'Content-Type': 'application/json'
        };

        // Build query with optional course filter (if provided, use it; otherwise get all)
        let query = `${base}/rest/v1/fileStore?select=*&order=created_at.desc&limit=${limit}&offset=${offset}`;
        
        if (course) {
            // Course is embedded in storage_key as first path segment
            // Example: CA/sem-1/subject/type/unit/file.pdf
            // Use LIKE pattern to filter by course
            query += `&storage_key=like.${encodeURIComponent(course)}/%`;
        }
        
        if (semester) {
            query += `&semester=eq.${encodeURIComponent(semester)}`;
        }
        if (subject) {
            query += `&subject=eq.${encodeURIComponent(subject)}`;
        }
        if (resourceType) {
            query += `&resource_type=eq.${encodeURIComponent(resourceType)}`;
        }

        const resp = await fetch(query, { headers });

        if (!resp.ok) {
            throw new Error(`Supabase query failed: ${resp.status}`);
        }

                const resources = await resp.json();

                // Create resource fingerprint map for differential updates
                const resourceMap = new Map();
                resources.forEach(r => {
                    const fingerprint = `${r.id}|${r.filename}|${r.link_title || ''}|${r.updated_at || r.created_at || ''}`;
                    resourceMap.set(r.id, { resource: r, fingerprint });
                });

                // Compute a stable hash (ETag) for the response to enable conditional requests.
                const hashInput = Array.from(resourceMap.values())
                    .map(v => v.fingerprint)
                    .sort()
                    .join('\n');
                let h = 0x811c9dc5; // FNV1a offset basis
                for (let i = 0; i < hashInput.length; i++) {
                    h ^= hashInput.charCodeAt(i);
                    h = (h >>> 0) * 0x01000193;
                    h = h >>> 0;
                }
                const etag = 'W/"res-' + h.toString(16) + '"';

                // Check if client has cached version
                const inm = request.headers.get('If-None-Match');
                
                // If exact match, return 304
                if (inm && inm === etag) {
                    return new Response(null, {
                        status: 304,
                        headers: {
                            'ETag': etag,
                            'Cache-Control': 'public, max-age=30',
                            'Vary': 'If-None-Match',
                            'Access-Control-Allow-Origin': request.headers.get('Origin') || '*',
                            'Access-Control-Allow-Credentials': 'true'
                        }
                    });
                }

                // If client has old ETag, try differential update
                let isDelta = false;
                let deltaResources = resources;
                if (inm && inm.startsWith('W/"res-')) {
                    // Store previous hash temporarily in KV for delta computation
                    // Extract old hash from ETag
                    const oldHash = inm.match(/W\/"res-([a-f0-9]+)"/)?.[1];
                    if (oldHash && env.SESSIONS) {
                        try {
                            const cacheKey = `etag_snapshot_${oldHash}`;
                            const cached = await env.SESSIONS.get(cacheKey, 'json');
                            if (cached && cached.ids) {
                                // Compute delta: only changed/new resources
                                const oldIds = new Set(cached.ids);
                                deltaResources = resources.filter(r => {
                                    if (!oldIds.has(r.id)) return true; // New resource
                                    // Check if fingerprint changed
                                    const oldFingerprint = cached.fingerprints?.[r.id];
                                    const newFingerprint = resourceMap.get(r.id)?.fingerprint;
                                    return oldFingerprint !== newFingerprint;
                                });
                                
                                // Find deleted IDs
                                const currentIds = new Set(resources.map(r => r.id));
                                const deletedIds = Array.from(oldIds).filter(id => !currentIds.has(id));
                                
                                if (deltaResources.length > 0 || deletedIds.length > 0) {
                                    isDelta = true;
                                    // Delta update computed successfully
                                }
                            }
                        } catch (e) {
                            log.warn('Delta computation failed', e);
                        }
                    }
                }

                // Cache current snapshot for future delta computation (30 min TTL)
                if (env.SESSIONS) {
                    try {
                        const cacheKey = `etag_snapshot_${etag.match(/res-([a-f0-9]+)/)?.[1]}`;
                        const snapshot = {
                            ids: resources.map(r => r.id),
                            fingerprints: Object.fromEntries(Array.from(resourceMap.entries()).map(([id, v]) => [id, v.fingerprint]))
                        };
                        await env.SESSIONS.put(cacheKey, JSON.stringify(snapshot), { expirationTtl: 1800 });
                    } catch (e) {
                        log.warn('Failed to cache ETag snapshot', e);
                    }
                }

        // Determine which resources to send (delta or full)
        const resourcesToSend = isDelta ? deltaResources : resources;
        
        // Create slim metadata version for efficient caching (minimal: id, title, filename, context fields)
        // Include storage_key for file downloads
        const slimResources = resourcesToSend.map(r => ({
            id: r.id,
            filename: r.filename,
            link_title: r.link_title,
            semester: r.semester,
            subject: r.subject,
            unit: r.unit,
            resource_type: r.resource_type,
            storage_key: r.storage_key // Required for file downloads
        }));

                const responseBody = {
                    success: true,
                    resources: slimResources,
                    count: slimResources.length,
                    hash: etag
                };

                // Add delta metadata if applicable
                if (isDelta) {
                    responseBody.delta = true;
                    responseBody.totalCount = resources.length;
                    // Include deleted IDs if any
                    if (inm) {
                        const oldHash = inm.match(/W\/"res-([a-f0-9]+)"/)?.[1];
                        if (oldHash && env.SESSIONS) {
                            try {
                                const cacheKey = `etag_snapshot_${oldHash}`;
                                const cached = await env.SESSIONS.get(cacheKey, 'json');
                                if (cached && cached.ids) {
                                    const currentIds = new Set(resources.map(r => r.id));
                                    const deletedIds = Array.from(cached.ids).filter(id => !currentIds.has(id));
                                    if (deletedIds.length > 0) {
                                        responseBody.deleted = deletedIds;
                                    }
                                }
                            } catch (e) {}
                        }
                    }
                }

                return new Response(JSON.stringify(responseBody), {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/json',
                        'ETag': etag,
                        'Cache-Control': 'public, max-age=30',
                        'Vary': 'If-None-Match'
                    }
                });

    } catch (e) {
        log.error('Failed to fetch resources', e);
                return new Response(JSON.stringify({
                    success: false,
                    error: 'internal_error',
                    message: e.message
                }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json' }
                });
    }
}
