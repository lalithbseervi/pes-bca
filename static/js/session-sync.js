/**
 * Session Sync Module
 * Synchronizes authentication state between browser tabs and PWA instances
 * Uses BroadcastChannel API + visibility API + service worker messaging
 */

import { API_BASE_URL } from './utils.js';

class SessionSync {
  constructor() {
    this.channel = null;
    this.listeners = new Set();
    this.heartbeatInterval = null;
    this.HEARTBEAT_TIMEOUT = 30000; // 30 seconds
    this.STORAGE_KEY = 'session_heartbeat';
    this.SESSION_KEY = 'user_session';
    this.LOGGED_IN_KEY = 'logged_in';
    
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

    // Listen for visibility changes to check session when tab becomes visible
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        this.checkSessionOnVisibilityChange();
      }
    });

    // Listen for storage events from other tabs/windows
    window.addEventListener('storage', (event) => {
      this.handleStorageEvent(event);
    });

    // Start heartbeat to detect stale sessions
    this.startHeartbeat();

    console.log('[SessionSync] Initialized');
  }

  /**
   * Handle messages from BroadcastChannel
   */
  handleMessage(event) {
    const { type, data } = event.data || {};

    switch (type) {
      case 'session_login':
        // Another tab logged in, sync the session
        console.log('[SessionSync] Received login from another tab');
        this.syncSessionFromBroadcast(data);
        this.notifyListeners('login', data);
        break;

      case 'session_logout':
        // Another tab logged out, clear local session
        console.log('[SessionSync] Received logout from another tab');
        this.clearLocalSession();
        this.notifyListeners('logout');
        break;

      case 'session_refresh':
        // Session was refreshed (new token, etc.)
        console.log('[SessionSync] Received session refresh');
        this.syncSessionFromBroadcast(data);
        this.notifyListeners('refresh', data);
        break;

      case 'session_check':
        // Another tab is checking if session exists
        const session = this.getSession();
        if (session) {
          this.broadcast('session_response', session);
        }
        break;

      case 'session_response':
        // Response to our check request
        if (!this.getSession() && data) {
          console.log('[SessionSync] Syncing session from peer tab');
          this.syncSessionFromBroadcast(data);
        }
        break;
    }
  }

  /**
   * Handle storage events (fired when another tab modifies localStorage/sessionStorage)
   */
  handleStorageEvent(event) {
    // Note: storage events don't fire for sessionStorage changes
    // They only fire for localStorage changes from OTHER tabs
    if (event.key === 'has_active_session' && !event.newValue) {
      // Session was cleared in another tab
      console.log('[SessionSync] Detected session clear via storage event');
      this.clearLocalSession();
      this.notifyListeners('logout');
    }
  }

  /**
   * Check session validity when tab becomes visible
   */
  async checkSessionOnVisibilityChange() {
    console.log('[SessionSync] Tab visible, checking session...');
    
    const session = this.getSession();
    if (!session) {
      // No session, check if another tab has one
      this.requestSessionFromPeers();
      return;
    }

    // Check if session expired
    if (this.isSessionExpired(session)) {
      console.log('[SessionSync] Session expired, attempting refresh...');
      const refreshed = await this.refreshSessionFromServer();
      if (!refreshed) {
        this.clearLocalSession();
        this.notifyListeners('expired');
      }
    }
  }

  /**
   * Start heartbeat to update last activity timestamp
   */
  startHeartbeat() {
    // Update heartbeat every 15 seconds if session exists
    this.heartbeatInterval = setInterval(() => {
      const session = this.getSession();
      if (session) {
        localStorage.setItem(this.STORAGE_KEY, Date.now().toString());
      }
    }, 15000);
  }

  /**
   * Stop heartbeat
   */
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Get current session from sessionStorage
   */
  getSession() {
    try {
      const sessionData = sessionStorage.getItem(this.SESSION_KEY);
      return sessionData ? JSON.parse(sessionData) : null;
    } catch (e) {
      console.error('[SessionSync] Failed to parse session:', e);
      return null;
    }
  }

  /**
   * Check if session is expired
   */
  isSessionExpired(session) {
    if (!session || !session.expiresAt) return false;
    
    try {
      const expiryTime = new Date(session.expiresAt).getTime();
      return Date.now() >= expiryTime;
    } catch (e) {
      return false;
    }
  }

  /**
   * Store session and broadcast to other tabs
   */
  storeSession(sessionData) {
    try {
      sessionStorage.setItem(this.SESSION_KEY, JSON.stringify(sessionData));
      sessionStorage.setItem(this.LOGGED_IN_KEY, 'true');
      localStorage.setItem('has_active_session', Date.now().toString());
      localStorage.setItem(this.STORAGE_KEY, Date.now().toString());
      
      // Broadcast to other tabs
      this.broadcast('session_login', sessionData);
      
      console.log('[SessionSync] Session stored and broadcasted');
    } catch (e) {
      console.error('[SessionSync] Failed to store session:', e);
    }
  }

  /**
   * Sync session from broadcast message
   */
  syncSessionFromBroadcast(sessionData) {
    if (!sessionData) return;
    
    try {
      sessionStorage.setItem(this.SESSION_KEY, JSON.stringify(sessionData));
      sessionStorage.setItem(this.LOGGED_IN_KEY, 'true');
      localStorage.setItem('has_active_session', Date.now().toString());
    } catch (e) {
      console.error('[SessionSync] Failed to sync session:', e);
    }
  }

  /**
   * Clear session locally
   */
  clearLocalSession() {
    sessionStorage.removeItem(this.SESSION_KEY);
    sessionStorage.removeItem(this.LOGGED_IN_KEY);
    sessionStorage.removeItem('stream_token');
    localStorage.removeItem('has_active_session');
    localStorage.removeItem(this.STORAGE_KEY);
  }

  /**
   * Clear session and broadcast logout
   */
  clearSession() {
    this.clearLocalSession();
    this.broadcast('session_logout');
    console.log('[SessionSync] Session cleared and logout broadcasted');
  }

  /**
   * Request session from other tabs
   */
  requestSessionFromPeers() {
    if (!this.channel) return;
    
    console.log('[SessionSync] Requesting session from peer tabs...');
    this.broadcast('session_check');
  }

  /**
   * Refresh session from server
   */
  async refreshSessionFromServer() {
    try {
      const response = await fetch(`${API_BASE_URL}/api/session`, {
        method: 'GET',
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      });

      if (!response.ok) return false;

      const data = await response.json();
      if (data.success && data.session) {
        this.storeSession(data.session);
        this.notifyListeners('refresh', data.session);
        console.log('[SessionSync] Session refreshed from server');
        return true;
      }
      
      return false;
    } catch (e) {
      console.error('[SessionSync] Failed to refresh session:', e);
      return false;
    }
  }

  /**
   * Broadcast message to other tabs
   */
  broadcast(type, data = null) {
    if (!this.channel) return;
    
    try {
      this.channel.postMessage({ type, data });
    } catch (e) {
      console.error('[SessionSync] Failed to broadcast:', e);
    }
  }

  /**
   * Add event listener for session changes
   * @param {Function} callback - Called with (event, data)
   * Event types: 'login', 'logout', 'refresh', 'expired'
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
   * Notify all listeners of a session event
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
   * Check if session exists and is valid
   */
  isLoggedIn() {
    const session = this.getSession();
    if (!session) return false;
    if (this.isSessionExpired(session)) return false;
    return sessionStorage.getItem(this.LOGGED_IN_KEY) === 'true';
  }

  /**
   * Cleanup resources
   */
  destroy() {
    this.stopHeartbeat();
    
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
