/**
 * GET /api/subjects/:code/meta
 * Get subject metadata (name, semester, course) from subjects_config
 */
import { createLogger } from '../utils/logger.js';

const log = createLogger('SubjectMeta');

export async function getSubjectMeta(request, env, subjectCode) {
    try {
        if (!subjectCode) {
            return new Response(JSON.stringify({ error: 'subject_code_required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Query Supabase for subject metadata
        const base = env.SUPABASE_URL?.replace(/\/+$/, '') || '';
        const key = env.SUPABASE_SERVICE_ROLE_KEY;
        if (!base || !key) {
            throw new Error('Supabase is not configured (SUPABASE_URL or SERVICE_ROLE_KEY missing)');
        }

        const headers = {
            Authorization: `Bearer ${key}`,
            apikey: key,
            'Content-Type': 'application/json'
        };

        const query = `${base}/rest/v1/subjects_config?subject_code=eq.${encodeURIComponent(subjectCode)}&select=course_id,semester,subject_code,subject_name&limit=1`;
        const resp = await fetch(query, { headers });

        if (!resp.ok) {
            const body = await resp.text();
            throw new Error(`Supabase query failed: ${resp.status} ${resp.statusText} ${body}`);
        }

        const rows = await resp.json();
        if (!Array.isArray(rows) || rows.length === 0) {
            log.warn('Subject not found in Supabase', { subjectCode });
            return new Response(JSON.stringify({ 
                error: 'subject_not_found',
                message: 'Subject does not exist'
            }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const result = rows[0];

        return new Response(JSON.stringify({
            course: result.course_id,
            semester: result.semester,
            code: result.subject_code,
            name: result.subject_name
        }), {
            status: 200,
            headers: { 
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=3600'
            }
        });

    } catch (error) {
        log.error('Failed to fetch subject metadata', { error: String(error && error.message) });
        return new Response(JSON.stringify({ 
            error: 'server_error',
            message: 'Failed to fetch subject information'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
