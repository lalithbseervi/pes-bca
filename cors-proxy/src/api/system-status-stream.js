/**
 * System Status Stream - Long Polling
 * Provides real-time system status updates with 25-second blocking timeout
 * GET /api/system/status/stream
 */
import { createLogger } from '../utils/logger.js';

const log = createLogger('SystemStatusStream');

/**
 * Long polling handler - blocks up to 25 seconds waiting for status changes
 * Returns immediately if status changes, or heartbeat after timeout
 */
async function statusHandler(request, env, ctx) {
  const MAX_DURATION_MS = 25_000; // safety margin
  const CHECK_INTERVAL_MS = 1_000;
  const REFRESH_INTERVAL_MS = 5_000; // throttle KV reads to stay under subrequest limits
  const clientSignature = request.headers.get('If-None-Match');

  const start = Date.now();

  try {
    // Initial snapshot
    const initial = await getSystemStatusData(env);
    let cachedStatus = initial;
    let lastPayload = JSON.stringify(initial);
    let lastSignature = JSON.stringify({
      maintenance_mode: initial.maintenance_mode,
      maintenance_message: initial.maintenance_message,
      version: initial.version
    });
    let nextRefreshAt = start + REFRESH_INTERVAL_MS;

    // If client signature differs, return immediately with latest
    if (clientSignature && clientSignature !== lastSignature) {
      return new Response(lastPayload, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
          'ETag': lastSignature
        }
      });
    }

    while (Date.now() - start < MAX_DURATION_MS) {
      // Sleep between checks
      await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL_MS));

      // If client disconnected (Miniflare safe)
      if (ctx?.isDone) {
        return;
      }

      try {
        // Refresh KV-backed status at a slower cadence to avoid hitting per-request subrequest limits
        const shouldRefresh = Date.now() >= nextRefreshAt;
        const current = shouldRefresh ? await getSystemStatusData(env) : cachedStatus;
        if (shouldRefresh) {
          cachedStatus = current;
          nextRefreshAt = Date.now() + REFRESH_INTERVAL_MS;
        }
        const signature = JSON.stringify({
          maintenance_mode: current.maintenance_mode,
          maintenance_message: current.maintenance_message,
          version: current.version
        });
        const serialized = JSON.stringify(current);

        // Status changed (ignoring timestamp) → respond immediately
        if (signature !== lastSignature) {
          lastSignature = signature;
          lastPayload = serialized;
          return new Response(serialized, {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-store',
              'Access-Control-Allow-Origin': '*',
              'ETag': signature
            }
          });
        }
      } catch (e) {
        log.error('Status poll error', e);
        break; // fail fast, don't spin
      }
    }

    // Timeout reached → heartbeat response
    return new Response(lastPayload, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Heartbeat': 'true',
        'Access-Control-Allow-Origin': '*',
        'ETag': lastSignature
      }
    });
  } catch (e) {
    log.error('Fake realtime handler error', e);
    return new Response('Internal error', { status: 500 });
  }
}

/**
 * Export handler for long polling
 */
export const streamSystemStatus = statusHandler;



/**
 * Get current system status data from KV/CONFIG
 */
async function getSystemStatusData(env) {
  try {
    let maintenanceMode = false;
    let maintenanceMessage = 'We are currently performing scheduled maintenance. Please check back soon.';
    let lastUpdate = Date.now();

    // Fetch maintenance mode and message from CONFIG_KV
    if (env.CONFIG_KV) {
      try {
        const modeData = await env.CONFIG_KV.get('config:maintenance_mode');
        if (modeData) {
          maintenanceMode = modeData === 'true';
        }
        const messageData = await env.CONFIG_KV.get('config:maintenance_message');
        if (messageData) {
          maintenanceMessage = messageData;
        }
      } catch (e) {
        log.warn('Failed to fetch status from CONFIG_KV:', e);
      }
    }

    return {
      timestamp: lastUpdate,
      maintenance_mode: maintenanceMode,
      maintenance_message: maintenanceMessage,
      version: env.SW_VERSION || 'unknown'
    };
  } catch (error) {
    log.error('Failed to get system status data:', error);
    return {
      timestamp: Date.now(),
      maintenance_mode: false,
      maintenance_message: 'Service unavailable',
      version: env.SW_VERSION || 'unknown'
    };
  }
}
