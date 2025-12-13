/**
 * Route Handlers for CSR Navigation
 * Handles subject pages, PDF viewer, and other protected routes
 */

import { API_BASE_URL } from '../utils.js';
import { initSubjectPage } from '../init/subject.js';
import { initPDFViewer } from '../init/pdf-viewer.js';

/**
 * Subject page route handler (protected)
 * Subject pages are now served dynamically by Worker, no Zola markdown needed
 */
export async function handleSubjectRoute(params, pathname) {
  let code = params.code;
  let sem = params.sem;
  
  if (!code || !sem) throw new Error('Subject code and semester required');
  
  console.log('[Router] Subject route handler - sem:', sem, 'code:', code, 'pathname:', pathname);

  // Subject pages are now fully dynamic - served by Worker /sem-X/code route
  // Do a full navigation to let Worker serve the HTML with proper context
  console.log('[Router] Navigating to dynamic subject page:', pathname);
  window.location.href = pathname;
}

/**
 * PDF Viewer route handler (protected)
 */
export async function handlePDFViewerRoute(params, pathname) {
  const url = new URL(pathname, window.location.origin);
  const filePath = url.searchParams.get('file');
  const title = url.searchParams.get('title');
  
  if (!filePath) {
    throw new Error('File path required for PDF viewer');
  }

  try {
    // Use pdf-viewer-init module (reusable for CSR like subject-init)
    await initPDFViewer(filePath, title, {
      loadViewer: true,
      buildNavigation: true
    });

    // Update page title
    document.title = title ? `${title} | read-only dash` : 'read-only dash';

  } catch (error) {
    console.error('PDF viewer route error:', error);
    throw error;
  }
}

/**
 * Check if a route should use CSR
 * Returns true if the path should be handled by router
 */
export function shouldUseCSR(pathname) {
  // Routes that should use CSR
  const csrRoutes = [
    /^\/pdf-viewer/,         // /pdf-viewer?file=...
  ];

  return csrRoutes.some(pattern => pattern.test(pathname));
}

/**
 * Initialize router and register routes
 * @param {Router} Router - Router class
 * @param {AuthManager} auth - Auth manager instance
 */
export function setupRouter(Router, auth) {
  const router = new Router({
    contentSelector: 'main, .main-content, .content',
    transitionDuration: 300
  });

  // Protected routes - require authentication
  router.on('/sem-:sem/:code', handleSubjectRoute, { requiresAuth: true });
  router.on('/sem-:sem/:code/', handleSubjectRoute, { requiresAuth: true });
  router.on('/pdf-viewer', handlePDFViewerRoute, { requiresAuth: true });

  // Add middleware to prevent navigation during downloads
  router.use(async (pathname) => {
    // Allow navigation if not currently downloading
    const downloadInProgress = document.body.classList.contains('downloading');
    if (downloadInProgress) {
      console.warn('Navigation blocked: Download in progress');
      return false;
    }
    return true;
  });

  return router;
}

