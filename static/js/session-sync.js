/**
 * Session Sync Module
 * Synchronizes session state between browser tabs using BroadcastChannel
 * 
 * NOTE: This is deprecated in favor of auth-manager.js for centralized auth.
 * Kept for backward compatibility during migration.
 */

class SessionSync {
  constructor() {
    this.channel = null;
    this.listeners = new Set();
    
    this.init();
  }

  init() {
    // Initialize BroadcastChannel for cross-tab sync
    try {
      this.channel = new BroadcastChannel('session_sync_channel');
      this.channel.onmessage = (event) => this.handleMessage(event);
      console.log('[SessionSync] BroadcastChannel initialized');
    } catch (e) {
      console.warn('[SessionSync] BroadcastChannel not supported:', e);
    }
  }

  /**
   * Handle messages from BroadcastChannel
   */
  handleMessage(event) {
    const { type, data } = event.data || {};
    
    // Notify listeners of sync events
    if (type === 'session_login') {
      this.notifyListeners('login', data);
    } else if (type === 'session_logout') {
      this.notifyListeners('logout');
    } else if (type === 'session_refresh') {
      this.notifyListeners('refresh', data);
    }
  }

  /**
   * Add event listener
   */
  addListener(callback) {
    if (typeof callback === 'function') {
      this.listeners.add(callback);
    }
  }

  /**
   * Remove event listener
   */
  removeListener(callback) {
    this.listeners.delete(callback);
  }

  /**
   * Notify all listeners
   */
  notifyListeners(event, data = null) {
    this.listeners.forEach(callback => {
      try {
        callback(event, data);
      } catch (e) {
        console.error('[SessionSync] Listener error:', e);
      }
    });
  }

  /**
   * Cleanup resources
   */
  destroy() {
    if (this.channel) {
      try {
        this.channel.close();
      } catch (e) {
        console.error('[SessionSync] Failed to close channel:', e);
      }
    }
    
    this.listeners.clear();
    console.log('[SessionSync] Destroyed');
  }
}

// Export singleton instance
const sessionSync = new SessionSync();

// Export for module and global usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = sessionSync;
}

// Make available globally
window.sessionSync = sessionSync;

export default sessionSync;
