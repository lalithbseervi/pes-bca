/**
 * System Status Stream - Server-Sent Events (SSE)
 * Provides real-time system status updates
 * GET /api/system/status/stream
 */
import { createLogger } from '../utils/logger.js';

const log = createLogger('SystemStatusStream');

// GET /api/system/status/stream - SSE using the same pattern as streamStatus
export async function streamSystemStatus(request, env) {
  const headers = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  (async () => {
    try {
      // Send initial status immediately
      const initial = await getSystemStatusData(env);
      let lastSent = JSON.stringify(initial);
      await writer.write(encoder.encode(`event: status\ndata: ${lastSent}\n\n`));

      // Periodic update check (every 30s), only send when changed
      const updateId = setInterval(async () => {
        try {
          const current = await getSystemStatusData(env);
          const serialized = JSON.stringify(current);
          if (serialized !== lastSent) {
            await writer.write(encoder.encode(`event: status\ndata: ${serialized}\n\n`));
            lastSent = serialized;
          }
        } catch (e) {
          log.error('System status SSE update error', e);
        }
      }, 30000);

      // Ping every 30s to keep connection alive
      const pingId = setInterval(async () => {
        try {
          await writer.write(encoder.encode(`: ping\n\n`));
        } catch (e) {
          clearInterval(pingId);
          clearInterval(updateId);
          writer.close().catch(() => {});
        }
      }, 30000);

      // Clean up on disconnect
      request.signal?.addEventListener('abort', () => {
        clearInterval(updateId);
        clearInterval(pingId);
        writer.close().catch(() => {});
      });
    } catch (e) {
      log.error('System status SSE stream error', e);
      await writer.close().catch(() => {});
    }
  })();

  return new Response(readable, { headers });
}



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
