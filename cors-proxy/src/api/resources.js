import { getCorsHeaders } from '../utils/cors.js';

/**
 * GET /api/resources - Get all resources with optional filters
 * Query params:
 *   - semester: filter by semester (e.g., "sem-1")
 *   - subject: filter by subject (e.g., "cfp")
 *   - resource_type: filter by type (e.g., "Notes")
 *   - limit: max number of results (default: 1000)
 *   - offset: pagination offset (default: 0)
 */
export async function getResources(request, env) {
    const cors = getCorsHeaders(request);
    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: cors });
    }

    try {
        const url = new URL(request.url);
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

        // Build query with filters
        let query = `${base}/rest/v1/fileStore?select=*&order=created_at.desc&limit=${limit}&offset=${offset}`;
        
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

        // Add stream URLs to each resource
        const resourcesWithUrls = resources.map(r => ({
            ...r,
            stream_url: `${new URL(request.url).origin}/api/resources/${r.id}/stream`
        }));

        return new Response(JSON.stringify({
            success: true,
            resources: resourcesWithUrls,
            count: resourcesWithUrls.length,
            filters: {
                semester: semester || null,
                subject: subject || null,
                resource_type: resourceType || null
            }
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', ...cors }
        });

    } catch (e) {
        console.error('getResources error:', e);
        return new Response(JSON.stringify({
            success: false,
            error: 'internal_error',
            message: e.message
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...cors }
        });
    }
}
