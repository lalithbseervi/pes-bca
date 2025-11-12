/**
 * Common utility functions used across templates
 */

// API Base URL - Environment detection
// Use local worker during local development (localhost), otherwise use
// same-origin relative paths so requests go through Pages Functions (/api/*)
export const API_BASE_URL = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
  ? 'http://localhost:8787'
  : '';

/**
 * Display a temporary message/alert to the user
 * @param {string} text - Message text (can include HTML)
 * @param {string} type - Message type: 'success', 'error', 'warning', 'info'
 * @param {string} targetId - ID of the element to display message in (default: 'message')
 * @param {number} duration - Duration in milliseconds (default: 5000)
 */
export function showMessage(text, type = 'success', targetId = 'message', duration = 5000) {
  const msgEl = document.getElementById(targetId);
  if (!msgEl) {
    console.warn(`Message target element #${targetId} not found`);
    return;
  }
  msgEl.innerHTML = `<div class="message ${type}">${text}</div>`;
  if (duration > 0) {
    setTimeout(() => msgEl.innerHTML = '', duration);
  }
}

/**
 * Display an alert (alternative naming for showMessage)
 * @param {string} message - Message text
 * @param {string} type - Alert type: 'success', 'error', 'warning', 'info'
 * @param {string} targetId - ID of the element to display alert in (default: 'alert')
 * @param {number} duration - Duration in milliseconds (default: 6000)
 */
export function showAlert(message, type = 'success', targetId = 'alert', duration = 6000) {
  const alertEl = document.getElementById(targetId);
  if (!alertEl) {
    console.warn(`Alert target element #${targetId} not found`);
    return;
  }
  alertEl.innerHTML = message;
  alertEl.className = `alert ${type === 'error' ? 'error' : type}`;
  if (duration > 0) {
    setTimeout(() => {
      alertEl.innerHTML = '';
      alertEl.className = '';
    }, duration);
  }
}

/**
 * Format bytes to human-readable size
 * @param {number} bytes - Number of bytes
 * @param {number} decimals - Number of decimal places (default: 2)
 * @returns {string} Formatted size (e.g., "1.5 MB")
 */
export function formatBytes(bytes, decimals = 2) {
  if (bytes === 0 || bytes === null || bytes === undefined) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

/**
 * Check if user is authenticated (has valid session)
 * Uses sessionSync module if available, otherwise fallback
 * @returns {boolean} True if authenticated
 */
export function isAuthenticated() {
  // Use sessionSync if available
  if (window.sessionSync && typeof window.sessionSync.isLoggedIn === 'function') {
    return window.sessionSync.isLoggedIn();
  }
  
  // Fallback for backward compatibility
  const sessionData = sessionStorage.getItem('user_session');
  if (!sessionData) return false;
  
  try {
    const session = JSON.parse(sessionData);
    if (!session || !session.srn) return false;
    
    if (session.expiresAt) {
      const expiresAt = new Date(session.expiresAt);
      if (expiresAt < new Date()) {
        sessionStorage.removeItem('user_session');
        return false;
      }
    }
    
    return true;
  } catch (e) {
    console.error('Error parsing session:', e);
    return false;
  }
}

/**
 * Get current user session data
 * Uses sessionSync module if available, otherwise fallback
 * @returns {object|null} Parsed session object or null
 */
export function getSession() {
  // Use sessionSync if available
  if (window.sessionSync && typeof window.sessionSync.getSession === 'function') {
    return window.sessionSync.getSession();
  }
  
  // Fallback for backward compatibility
  const sessionData = sessionStorage.getItem('user_session');
  if (!sessionData) return null;
  
  try {
    return JSON.parse(sessionData);
  } catch (e) {
    console.error('Error parsing session:', e);
    return null;
  }
}

/**
 * Redirect to login and save current page for post-login redirect
 * @param {string} redirectUrl - URL to redirect to after login (default: current page)
 */
export function redirectToLogin(redirectUrl = window.location.href) {
  localStorage.setItem('postLoginRedirect', redirectUrl);
  window.location.href = '/';
}

/**
 * Require authentication - redirect to login if not authenticated
 * @param {string} redirectUrl - URL to redirect to after login
 * @returns {boolean} True if authenticated, false if redirected
 */
export function requireAuth(redirectUrl = window.location.href) {
  if (!isAuthenticated()) {
    redirectToLogin(redirectUrl);
    return false;
  }
  return true;
}

/**
 * Check admin passphrase
 * @param {boolean} forcePrompt - Force prompt even if passphrase exists in session
 * @param {boolean} requireUserAuth - Whether to require user authentication first (default: false)
 * @returns {Promise<string|null>} Passphrase or null if cancelled/failed
 */
export async function checkAdminAuth(forcePrompt = false, requireUserAuth = false) {
  // Optionally check if user is logged in first
  if (requireUserAuth && !isAuthenticated()) {
    redirectToLogin();
    return null;
  }
  
  // Check if we already have a valid admin passphrase
  if (!forcePrompt) {
    const existingPassphrase = sessionStorage.getItem('admin_passphrase');
    if (existingPassphrase) return existingPassphrase;
  }
  
  // Prompt for passphrase
  const passphrase = prompt('Enter admin passphrase:');
  if (!passphrase) return null;
  
  // Verify with API
  try {
    const resp = await fetch(`${API_BASE_URL}/api/admin/verify-passphrase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ passphrase })
    });
    
    const data = await resp.json();
    
    if (!resp.ok || !data.valid) {
      alert('Invalid admin passphrase');
      return null;
    }
    
    // Store valid passphrase
    sessionStorage.setItem('admin_passphrase', passphrase);
    return passphrase;
  } catch (error) {
    console.error('Admin auth error:', error);
    alert('Failed to verify admin passphrase');
    return null;
  }
}

/**
 * Get admin passphrase from session storage
 * @returns {string|null} Passphrase or null
 */
export function getAdminPassphrase() {
  return sessionStorage.getItem('admin_passphrase');
}

/**
 * Make an authenticated API request
 * @param {string} endpoint - API endpoint (e.g., '/api/resources')
 * @param {object} options - Fetch options
 * @returns {Promise<Response>} Fetch response
 */
export async function authenticatedFetch(endpoint, options = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint}`;
  
  const defaultOptions = {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  };
  
  return fetch(url, { ...defaultOptions, ...options });
}

/**
 * Make an admin API request (includes admin passphrase)
 * @param {string} endpoint - API endpoint
 * @param {object} options - Fetch options
 * @returns {Promise<Response>} Fetch response
 */
export async function adminFetch(endpoint, options = {}) {
  const passphrase = getAdminPassphrase();
  if (!passphrase) {
    throw new Error('Admin passphrase not found');
  }
  
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint}`;
  
  const defaultOptions = {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Passphrase': passphrase,
      ...options.headers
    }
  };
  
  return fetch(url, { ...defaultOptions, ...options });
}

/**
 * Debounce function - delay execution until after wait time has elapsed
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} Debounced function
 */
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Throttle function - limit execution to once per wait period
 * @param {Function} func - Function to throttle
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} Throttled function
 */
export function throttle(func, wait) {
  let inThrottle;
  return function executedFunction(...args) {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, wait);
    }
  };
}
