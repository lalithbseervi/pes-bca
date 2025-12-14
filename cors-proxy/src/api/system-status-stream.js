/**
 * System Status Stream - Server-Sent Events (SSE)
 * Provides real-time system status updates without polling
 * GET /api/system/status/stream
 */
import { createLogger } from '../utils/logger.js';

const log = createLogger('SystemStatusStream');

/**
 * Stream system status updates via SSE
 * Sends maintenance mode and announcement changes in real-time
 */
export async function streamSystemStatus(request, env) {
  try {
    // Create a ReadableStream that sends updates
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let lastStatus = null;
        let closed = false;

        // Send initial status
        try {
          const initialStatus = await getSystemStatusData(env);
          lastStatus = JSON.stringify(initialStatus);
          const message = `event: status\ndata: ${lastStatus}\n\n`;
          controller.enqueue(encoder.encode(message));
        } catch (error) {
          log.error('Failed to send initial status:', error);
        }

        // Set up interval for periodic updates
        const intervalId = setInterval(async () => {
          if (closed) {
            clearInterval(intervalId);
            return;
          }

          try {
            const currentStatus = await getSystemStatusData(env);
            const currentJson = JSON.stringify(currentStatus);
            
            // Only send if status changed
            if (currentJson !== lastStatus) {
              const message = `event: status\ndata: ${currentJson}\n\n`;
              controller.enqueue(encoder.encode(message));
              lastStatus = currentJson;
            }
          } catch (error) {
            log.error('Error sending SSE update:', error);
            clearInterval(intervalId);
            controller.close();
            closed = true;
          }
        }, 45000); // 45 second interval

        // Handle client disconnect
        request.signal?.addEventListener('abort', () => {
          clearInterval(intervalId);
          if (!closed) {
            controller.close();
            closed = true;
          }
        });
      }
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable buffering for SSE
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });

  } catch (error) {
    log.error('Failed to stream system status:', error);
    return new Response(JSON.stringify({ error: 'Stream initialization failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
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
