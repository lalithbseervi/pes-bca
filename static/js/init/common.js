/**
 * Common initialization script
 * This is a non-module wrapper that imports utils.js and exposes functions globally
 * Use this for templates that can't use ES6 modules
 */

import * as utils from '../utils.js';

// Expose all utilities as global window functions
window.API_BASE_URL = utils.API_BASE_URL;
window.showMessage = utils.showMessage;
window.showAlert = utils.showAlert;
window.formatBytes = utils.formatBytes;
window.isAuthenticated = utils.isAuthenticated;
window.getSession = utils.getSession;
window.redirectToLogin = utils.redirectToLogin;
window.requireAuth = utils.requireAuth;
window.checkAdminAuth = utils.checkAdminAuth;
window.getAdminPassphrase = utils.getAdminPassphrase;
window.authenticatedFetch = utils.authenticatedFetch;
window.adminFetch = utils.adminFetch;
window.debounce = utils.debounce;
window.throttle = utils.throttle;

// Log initialization
console.log('[Common Utils] Initialized with API_BASE_URL:', window.API_BASE_URL);
