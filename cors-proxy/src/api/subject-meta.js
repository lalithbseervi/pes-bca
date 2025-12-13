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

        const stmt = env.USER_DB.prepare(
            `SELECT course_id, semester, subject_code, subject_name 
             FROM subjects_config 
             WHERE subject_code = ? 
             LIMIT 1`
        );

        const result = await stmt.bind(subjectCode).first();

        if (!result) {
            log.warn('Subject not found', { subjectCode });
            return new Response(JSON.stringify({ 
                error: 'subject_not_found',
                message: 'Subject does not exist'
            }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        log.info('Subject metadata fetched', { subjectCode, name: result.subject_name });

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
        log.error('Failed to fetch subject metadata', error);
        return new Response(JSON.stringify({ 
            error: 'server_error',
            message: 'Failed to fetch subject information'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
