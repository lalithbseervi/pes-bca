import { createLogger } from '../utils/logger.js';

const log = createLogger('ContributeForm');

export async function handleFormReq(request, env) {
    const JSON_HEADERS = { 'Content-Type': 'application/json' }

    try {
        // Parse request body
        const requestBody = await request.json();
        const socialId = requestBody.social_id;

        if (!socialId) {
            return new Response('Social ID is required', { status: 400, headers: JSON_HEADERS });
        }

        // Store social ID in KV store
        await env.SESSIONS.put(`contrib:${socialId}`, Date.now().toString());

        // Respond back with a success message
        return new Response(`Thank you, ${socialId}! We will contact you soon.`, { status: 200, headers: JSON_HEADERS });
    } catch (error) {
        log.error('Failed to process contribution form', error);
        return new Response('Error processing request', { status: 500, headers: JSON_HEADERS });
    }
}
