// Public API endpoint to fetch system configuration (maintenance mode, announcements)
// This is accessible without authentication

import { createLogger } from "../utils/logger.js";

const log = createLogger('SystemStatus');
const JSON_HEADERS = {
    'Content-Type': 'application/json'
};

export async function getPublicSystemStatus(env) {
    try {
        const configStore = env.CONFIG_KV;
        if (!configStore) {
            return new Response(JSON.stringify({ 
                maintenance_mode: false
            }), {
                status: 200,
                headers: JSON_HEADERS
            });
        }

        // Fetch public-facing configuration
        const [maintenanceMode, maintenanceMessage] = await Promise.all([
            configStore.get('config:maintenance_mode'),
            configStore.get('config:maintenance_message')
        ]);

        const status = {
            maintenance_mode: maintenanceMode === 'true',
            maintenance_message: maintenanceMessage || 'We are currently performing scheduled maintenance. Please check back soon.',
            timestamp: Date.now()
        };

        return new Response(JSON.stringify(status), {
            status: 200,
            headers: {
                ...JSON_HEADERS,
                'Cache-Control': 'public, max-age=30' // Cache for 30 seconds
            }
        });
    } catch (e) {
        log.error('Failed to fetch system status', e);
        return new Response(JSON.stringify({ 
            error: 'Failed to fetch system status',
            maintenance_mode: false
        }), {
            status: 500,
            headers: JSON_HEADERS
        });
    }
}

// Report 5XX errors automatically
export async function reportError(request, env) {
    try {
        const body = await request.json();
        const { error, statusCode, url, timestamp, userAgent } = body;

        if (!statusCode || statusCode < 500) {
            return new Response(JSON.stringify({ error: 'Only 5XX errors should be reported' }), {
                status: 400,
                headers: JSON_HEADERS
            });
        }

        // Log to KV for monitoring
        if (env.RATE_LIMIT_KV) {
            const errorKey = `error:${timestamp}:${Math.random().toString(36).slice(2, 8)}`;
            await env.RATE_LIMIT_KV.put(errorKey, JSON.stringify({
                statusCode,
                url,
                error,
                timestamp,
                userAgent
            }), {
                expirationTtl: 86400 // Keep errors for 24 hours
            });
        }

        // Could also trigger incident creation if multiple errors in short time
        // For now, just log and acknowledge

        return new Response(JSON.stringify({ 
            success: true,
            message: 'Error reported'
        }), {
            status: 200,
            headers: JSON_HEADERS
        });
    } catch (e) {
        log.error('Error reporting failed', e);
        return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: JSON_HEADERS
        });
    }
}
