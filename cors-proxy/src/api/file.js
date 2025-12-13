// API endpoint to serve files via Supabase signed URLs
import { checkRateLimit, rateLimitResponse, deriveRateLimitIdentity } from '../utils/rate-limit.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('File');
const BUCKET = 'fileStore';

// Helper to fetch file directly from Supabase Storage using authenticated request
async function fetchFileFromStorage(env, bucket, storageKey) {
    // Encode path segments individually for proper URL construction
    const encodedPath = storageKey.split('/').map(segment => encodeURIComponent(segment)).join('/');
    const url = env.SUPABASE_URL.replace(/\/+$/, '') + `/storage/v1/object/${bucket}/${encodedPath}`;
    const headers = { 
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 
        apikey: `${env.SUPABASE_SERVICE_ROLE_KEY}` 
    };

    try {
        const response = await fetch(url, { headers });
        
        if (response.ok) {
            return response;
        } else {
            const errorText = await response.text();
            log.error(`Failed to fetch from storage (${response.status})`, new Error(errorText));
            return null;
        }
    } catch (e) {
        log.error('File storage fetch error', e);
        return null;
    }
}

// GET /api/file/:storageKey - Get a file via signed URL (redirect)
export async function getFile(request, env, ctx) {
    try {
        // Get client IP for rate limiting
            // Derive per-user (SRN) identity when logged-in; else fall back to IP
            const rateLimitId = await deriveRateLimitIdentity(request, env);
        
        // Check rate limit (persistent, consume request)
            const limitInfo = await checkRateLimit(rateLimitId, env, { consume: true });
        if (!limitInfo.allowed) {
                log.warn(`Rate limit exceeded for ${rateLimitId}`);
            return rateLimitResponse(limitInfo);
        }
        
        // Rate limit headers for responses
        const rateLimitHeaders = {
            'X-RateLimit-Limit': limitInfo.limit.toString(),
            'X-RateLimit-Remaining': limitInfo.remaining.toString(),
            'X-RateLimit-Reset': limitInfo.resetAt,
            'X-RateLimit-Violation-Count': (limitInfo.violationCount || 0).toString()
        };
        
        const { storageKey } = ctx.params;
        
        if (!storageKey) {
            log.error('Missing storage key in request', null);
            return new Response(JSON.stringify({ error: 'Missing storage key' }), { 
                status: 400,
                headers: { 'Content-Type': 'application/json', ...rateLimitHeaders }
            });
        }
        
        // Decode the storage key
        const decodedKey = decodeURIComponent(storageKey);
        
        // Fetch file directly from Supabase Storage using service role auth
        // This avoids signed URL encoding issues and keeps endpoint hidden
        const fileResponse = await fetchFileFromStorage(env, BUCKET, decodedKey);
        
        if (!fileResponse) {
            log.error(`Failed to fetch file: ${decodedKey}`, null);
            return new Response(JSON.stringify({ 
                error: 'Failed to fetch file from storage',
                storageKey: decodedKey
            }), { 
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }        // Return the file with proper headers including rate limit info
        return new Response(fileResponse.body, {
            status: 200,
            headers: {
                'Content-Type': fileResponse.headers.get('Content-Type') || 'application/octet-stream',
                'Content-Disposition': fileResponse.headers.get('Content-Disposition') || `attachment; filename="${decodedKey.split('/').pop()}"`,
                'Content-Length': fileResponse.headers.get('Content-Length'),
                'Cache-Control': 'public, max-age=3600',
                'Access-Control-Allow-Origin': '*',
                ...rateLimitHeaders
            }
        });
    } catch (e) {
        log.error(`File serving error for ${ctx.params?.storageKey}`, e);
        return new Response(JSON.stringify({ 
            error: 'Internal server error',
            message: e.message,
            storageKey: ctx.params?.storageKey
        }), { 
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
