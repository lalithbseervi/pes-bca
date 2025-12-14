/**
 * System Status Stream - Server-Sent Events (SSE)
 * Provides real-time system status updates using cloudflare-workers-sse
 * GET /api/system/status/stream
 */
import { createLogger } from '../utils/logger.js';
import { sse } from 'cloudflare-workers-sse';

const log = createLogger('SystemStatusStream');

/**
 * Async generator handler for SSE stream
 * Yields status updates and ping messages to keep connection alive
 */
async function* statusHandler(request, env, ctx) {
  try {
    // Send initial status immediately
    const initial = await getSystemStatusData(env);
    yield {
      event: 'status',
      data: JSON.stringify(initial)
    };

    let lastSent = JSON.stringify(initial);
    let iteration = 0;

    // Send updates while request is active
    while (true) {
      // Wait 10 seconds between checks (200 x 50ms = 10000ms)
      // Small delays allow Worker to handle other requests and respect ctx.isDone
      for (let i = 0; i < 200; i++) {
        await new Promise(resolve => setTimeout(resolve, 50));
        // ctx may be undefined in local Miniflare; check before using
        if (ctx?.isDone) {
          return; // Exit gracefully when request is done or canceled
        }
      }

      iteration++;

      // Check for status changes every 10 seconds
      try {
        const current = await getSystemStatusData(env);
        const serialized = JSON.stringify(current);
        
        if (serialized !== lastSent) {
          yield {
            event: 'status',
            data: serialized
          };
          lastSent = serialized;
        }
      } catch (e) {
        log.error('System status SSE update error', e);
      }

      // Send ping every 3 iterations (30 seconds) to keep connection alive
      if (iteration % 3 === 0) {
        yield {
          data: ': ping'
        };
      }
    }
  } catch (e) {
    log.error('System status SSE stream error', e);
  }
}

/**
 * Export SSE handler using cloudflare-workers-sse
 * The library handles streaming, error handling, and client disconnection
 */
export const streamSystemStatus = sse(statusHandler, {
  customHeaders: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  }
});



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
