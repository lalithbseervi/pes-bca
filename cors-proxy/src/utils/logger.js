/**
 * Centralized logging utility for consistent console output
 * 
 * Format: [LEVEL] [Component] Message
 * - Errors and warnings include error objects on separate line
 * - Info logs use descriptive, actionable messages
 * - Debug logs removed from production code
 * 
 * Usage:
 *   import { createLogger } from '../utils/logger.js';
 *   const log = createLogger('FileName');
 *   
 *   log.info('User authenticated');
 *   log.warn('Invalid file type detected');
 *   log.error('Database query failed', error);
 */

export function createLogger(component) {
  return {
    /**
     * Log informational message
     * @param {string} message - Descriptive message
     * @param {*} data - Optional additional data (object, string, etc.)
     */
    info(message, data) {
      if (data !== undefined && data !== null) {
        console.log(`[INFO] [${component}] ${message}`, data);
      } else {
        console.log(`[INFO] [${component}] ${message}`);
      }
    },

    /**
     * Log warning message
     * @param {string} message - Warning message
     * @param {Error|*} errorOrData - Error object or additional data
     */
    warn(message, errorOrData) {
      if (errorOrData instanceof Error) {
        console.warn(`[WARN] [${component}] ${message}`, errorOrData.message);
      } else if (errorOrData !== undefined && errorOrData !== null) {
        console.warn(`[WARN] [${component}] ${message}`, errorOrData);
      } else {
        console.warn(`[WARN] [${component}] ${message}`);
      }
    },

    /**
     * Log error message with error details
     * @param {string} message - Error message
     * @param {Error} error - Error object
     */
    error(message, error) {
      console.error(`[ERROR] [${component}] ${message}`);
      if (error instanceof Error) {
        console.error(`  ${error.message}`);
        if (error.stack) {
          console.error(`  Stack: ${error.stack}`);
        }
      } else if (error !== undefined && error !== null) {
        console.error(`  Details: ${JSON.stringify(error)}`);
      }
    }
  };
}
