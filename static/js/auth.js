/**
 * Centralized Authentication Manager
 * Single source of truth for all auth decisions
 * Uses HttpOnly cookies (access_token, refresh_token) + server validation
 * Works across browser tabs, PWA instances, and redirects
 */

import { API_BASE_URL } from './utils.js';

class AuthManager {
  constructor() {
    this.SESSION_KEY = 'user_session';
    this.lastAuthCheck = 0;
    this.authCheckCooldown = 3600000; // Don't check more than every 1 hour
    this.cachedSession = null;
    this.listeners = new Map(); // For event listeners
    
    this.init();
  }

  init() {
    console.log('[Auth] Manager initialized');
    
    // When page becomes visible after being hidden, refresh auth status
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        this.refreshAuthStatus();
      }
    });
  }

  /**
   * Check if authenticated synchronously (uses cached session)
   * For quick UI checks - doesn't hit server
   * @returns {boolean} True if authenticated
   */
  isAuthenticatedSync() {
    return this.hasLocalSession();
  }

  /**
   * Check if user is authenticated by verifying with server
   * Server checks access_token and refresh_token cookies
   * Respects cooldown to avoid excessive requests
   */
  async isAuthenticated() {
    const now = Date.now();
    
    // Use cached result if within cooldown
    if (this.cachedSession && (now - this.lastAuthCheck) < this.authCheckCooldown) {
      return !!this.cachedSession;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/api/session`, {
        method: 'GET',
        credentials: 'include', // Include cookies (access_token, refresh_token)
        headers: { 'Accept': 'application/json' }
      });

      this.lastAuthCheck = now;

      if (res.ok) {
        const data = await res.json();
        if (data.success && data.session) {
          this.storeSession(data.session);
          this.cachedSession = data.session;
          console.log('[Auth] Authenticated:', data.session.srn);
          return true;
        }
      } else if (res.status === 401) {
        // Unauthorized - tokens invalid or expired
        this.clearLocalSession();
        this.cachedSession = null;
        console.log('[Auth] Authentication failed (401)');
        return false;
      }
      
      return false;
    } catch (e) {
      console.error('[Auth] Session check failed:', e);
      
      // Fallback: check if we have a recent local session
      return this.hasLocalSession();
    }
  }

  /**
   * Refresh auth status without cooldown
   * Called when tab becomes visible after being hidden
   */
  async refreshAuthStatus() {
    this.lastAuthCheck = 0; // Reset cooldown
    this.cachedSession = null; // Clear cache
    
    console.log('[Auth] Refreshing auth status...');
    return await this.isAuthenticated();
  }

  /**
   * Ensure user is authenticated, or show login modal
   * Called during page initialization
   */
  async ensureAuthenticated() {
    const isAuth = await this.isAuthenticated();
    
    if (!isAuth) {
      console.log('[Auth] Not authenticated, showing login modal');
      const loginModal = document.getElementById('login-modal');
      if (loginModal) {
        loginModal.style.display = 'block';
      }
    }
    
    return isAuth;
  }

  /**
   * Middleware for router - checks auth before allowing navigation to protected routes
   * @param {string} pathname - Route path
   * @param {Object} route - Route object from router
   * @returns {Promise<boolean>} True if allowed, false if blocked
   */
  async requireAuth(pathname, route) {
    const isAuth = await this.isAuthenticated();
    
    if (!isAuth) {
      console.log('[Auth] Navigation blocked - not authenticated');
      
      // Show login modal if it exists
      const loginModal = document.getElementById('login-modal');
      if (loginModal) {
        loginModal.style.display = 'block';
      }
      
      // Show main content hidden
      const content = document.querySelector('.body, main, .main-content');
      if (content) {
        content.style.display = 'none';
      }
      
      return false; // Block navigation
    }
    
    return true; // Allow navigation
  }

  /**
   * Store session data locally for immediate UI access
   * Note: Server is source of truth via cookies
   */
  storeSession(sessionData) {
    if (!sessionData) return;
    
    try {
      sessionStorage.setItem(this.SESSION_KEY, JSON.stringify(sessionData));
      console.log('[Auth] Session stored locally');
    } catch (e) {
      console.error('[Auth] Failed to store session:', e);
    }
  }

  /**
   * Clear local session data
   */
  clearLocalSession() {
    try {
      sessionStorage.removeItem(this.SESSION_KEY);
      sessionStorage.removeItem('stream_token');
      console.log('[Auth] Local session cleared');
    } catch (e) {
      console.error('[Auth] Failed to clear session:', e);
    }
  }

  /**
   * Check if we have a valid local session
   * (Note: server is still the source of truth via cookies)
   */
  hasLocalSession() {
    try {
      const sessionData = sessionStorage.getItem(this.SESSION_KEY);
      
      if (!sessionData) return false;
      
      const session = JSON.parse(sessionData);
      
      // Check if session is expired
      if (session.expiresAt) {
        const expiresAt = new Date(session.expiresAt).getTime();
        if (Date.now() >= expiresAt) {
          this.clearLocalSession();
          return false;
        }
      }
      
      return true;
    } catch (e) {
      console.error('[Auth] Error checking local session:', e);
      return false;
    }
  }

  /**
   * Get locally stored session data
   * (Note: for immediate UI needs; server is source of truth)
   */
  getLocalSession() {
    try {
      const sessionData = sessionStorage.getItem(this.SESSION_KEY);
      if (!sessionData) return null;
      
      const session = JSON.parse(sessionData);
      
      // Check if session is expired
      if (session.expiresAt) {
        const expiresAt = new Date(session.expiresAt).getTime();
        if (Date.now() >= expiresAt) {
          this.clearLocalSession();
          return null;
        }
      }
      
      return session;
    } catch (e) {
      console.error('[Auth] Error getting session:', e);
      return null;
    }
  }

  /**
   * Perform login
   * @param {string} srn - Username/SRN/Email/Phone
   * @param {string} password - Password
   * @returns {Promise<Object>} Login result { success, session, message }
   */
  async login(srn, password) {
    try {
      const payload = { srn, password };
      
      const res = await fetch(`${API_BASE_URL}/api/login?redirect=${encodeURIComponent('/')}`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        credentials: 'include', // This allows cookies to be set
        body: JSON.stringify(payload)
      });

      const data = await res.json().catch(() => ({ success: false }));

      if (res.ok && data.success) {
        // Store session locally
        if (data.session) {
          this.storeSession(data.session);
          this.cachedSession = data.session;
        }
        this.lastAuthCheck = Date.now();
        
        console.log('[Auth] Login successful');
        return { 
          success: true, 
          session: data.session,
          cached: data.cached,
          guest_mode: data.guest_mode
        };
      } else {
        const message = data.error || data.message || 'Login failed';
        console.log('[Auth] Login failed:', message);
        return { 
          success: false, 
          message 
        };
      }
    } catch (err) {
      console.error('[Auth] Login error:', err);
      return { 
        success: false, 
        message: 'Network error' 
      };
    }
  }

  /**
   * Perform logout
   */
  async logout() {
    try {
      // Call logout endpoint to clear server-side cookies
      await fetch(`${API_BASE_URL}/api/logout`, {
        method: 'POST',
        credentials: 'include'
      }).catch(() => {}); // Ignore errors
      
      // Clear local session
      this.clearLocalSession();
      this.cachedSession = null;
      this.lastAuthCheck = 0;
      
      console.log('[Auth] Logout successful');
      return true;
    } catch (err) {
      console.error('[Auth] Logout error:', err);
      return false;
    }
  }

  /**
   * Try to restore session from server when page loads
   * Useful for page refreshes or returning users
   */
  async restoreSession() {
    console.log('[Auth] Attempting to restore session...');
    const isAuth = await this.isAuthenticated();
    
    if (isAuth) {
      // Show content
      const content = document.querySelector('.body, main, .main-content');
      if (content) content.style.display = 'block';
      
      // Hide login modal
      const loginModal = document.getElementById('login-modal');
      if (loginModal) loginModal.style.display = 'none';
      
      return true;
    } else {
      // Show login modal
      const loginModal = document.getElementById('login-modal');
      if (loginModal) loginModal.style.display = 'block';
      
      // Hide content
      const content = document.querySelector('.body, main, .main-content');
      if (content) content.style.display = 'none';
      
      return false;
    }
  }

  /**
   * Get current session (synchronous, from local storage)
   * @returns {Object|null} Session data
   */
  getSession() {
    return this.getLocalSession();
  }

  /**
   * Register event listener
   * @param {string} event - Event name ('login', 'logout', 'session-expired', etc.)
   * @param {Function} callback - Callback function
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  /**
   * Remove event listener
   */
  off(event, callback) {
    if (this.listeners.has(event)) {
      const callbacks = this.listeners.get(event);
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  /**
   * Emit event to all listeners
   */
  emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(callback => {
        try {
          callback(data);
        } catch (e) {
          console.error('[Auth] Listener error:', e);
        }
      });
    }
  }
}

// Export singleton instance
const auth = new AuthManager();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = auth;
}

window.auth = auth;

export default auth;
