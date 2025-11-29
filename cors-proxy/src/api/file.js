// API endpoint to serve files via Supabase signed URLs
import { checkRateLimit, rateLimitResponse } from '../utils/rate-limit.js';

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
            console.error('Failed to fetch file from storage:', response.status, errorText);
            return null;
        }
    } catch (e) {
        console.error('Failed to fetch file from storage:', e);
        return null;
    }
}

// GET /api/file/:storageKey - Get a file via signed URL (redirect)
export async function getFile(request, env, ctx) {
    try {
        // Get client IP for rate limiting
        const clientIP = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
        
        // Check rate limit (persistent, consume request)
        const limitInfo = await checkRateLimit(clientIP, env, { consume: true });
        if (!limitInfo.allowed) {
            console.warn('Rate limit exceeded for IP:', clientIP);
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
            console.error('Missing storage key in request');
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
            console.error('Failed to fetch file from storage for:', decodedKey);
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
        console.error('Get file error for storage key:', ctx.params?.storageKey, 'Error:', e);
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
