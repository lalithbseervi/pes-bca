/**
 * System Status Stream - Server-Sent Events (SSE)
 * Provides real-time system status updates using cloudflare-workers-sse
 * GET /api/system/status/stream
 */
import { createLogger } from '../utils/logger.js';
import { ServerSentEventsTarget } from 'cloudflare-workers-sse';

const log = createLogger('SystemStatusStream');

/**
 * Stream system status updates via SSE
 * Uses cloudflare-workers-sse for proper stream management
 */
export async function streamSystemStatus(request, env) {
  try {
    const target = new ServerSentEventsTarget();
    let lastStatus = null;
    let closed = false;

    // Send updates function
    const sendUpdate = async () => {
      if (closed) return;
      
      try {
        const currentStatus = await getSystemStatusData(env);
        const currentJson = JSON.stringify(currentStatus);
        
        // Send initial status or when changed
        if (lastStatus === null || currentJson !== lastStatus) {
          target.sendEvent({
            event: 'status',
            data: currentJson
          });
          lastStatus = currentJson;
        }
      } catch (error) {
        log.error('Error sending SSE update:', error);
      }
    };

    // Send initial status immediately
    await sendUpdate();

    // Set up periodic updates every 30 seconds
    const intervalId = setInterval(async () => {
      await sendUpdate();
    }, 30000);

    // Clean up on disconnect
    target.addEventListener('close', () => {
      closed = true;
      clearInterval(intervalId);
    });

    return target.response;

  } catch (error) {
    log.error('Failed to initialize SSE stream:', error);
    return new Response(JSON.stringify({ error: 'Stream initialization failed' }), {
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
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
