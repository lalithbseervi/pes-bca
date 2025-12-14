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
    // Create a TransformStream to handle SSE formatting
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();

    // Send initial status
    let lastStatus = await getSystemStatusData(env);
    await sendSSEMessage(writer, 'status', lastStatus);

    // Set up periodic updates (every 45 seconds)
    const updateInterval = setInterval(async () => {
      try {
        const currentStatus = await getSystemStatusData(env);
        
        // Only send if status changed
        if (JSON.stringify(currentStatus) !== JSON.stringify(lastStatus)) {
          await sendSSEMessage(writer, 'status', currentStatus);
          lastStatus = currentStatus;
        }
      } catch (error) {
        log.error('Error sending SSE update:', error);
        clearInterval(updateInterval);
        await writer.close();
      }
    }, 45000); // 45 second interval

    // Handle client disconnect
    request.signal?.addEventListener('abort', () => {
      clearInterval(updateInterval);
      writer.close().catch(() => {});
    });

    return new Response(readable, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no' // Disable buffering for SSE
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
 * Send SSE message with event type and data
 */
async function sendSSEMessage(writer, eventType, data) {
  try {
    const message = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    await writer.write(new TextEncoder().encode(message));
  } catch (error) {
    log.error('Failed to send SSE message:', error);
    throw error;
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
