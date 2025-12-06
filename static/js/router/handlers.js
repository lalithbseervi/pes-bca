/**
 * Route Handlers for CSR Navigation
 * Handles subject pages, PDF viewer, and other protected routes
 */

import { API_BASE_URL } from '../utils.js';
import { initSubjectPage } from '../init/subject.js';
import { initPDFViewer } from '../init/pdf-viewer.js';

/**
 * Subject page route handler (protected)
 */
export async function handleSubjectRoute(params) {
  const { code } = params;
  
  if (!code) throw new Error('Subject code required');

  try {
    // Initialize subject page (works for both SSR and CSR)
    await initSubjectPage(code, '1', {
      contentSelector: 'main, .main-content, .content',
      loadingSelector: '#loading',
      contentAreaSelector: '#content-area',
      errorSelector: '#error',
      subjectContentSelector: '#subject-content',
      searchInputSelector: '#search-input',
      noResultsSelector: '#no-results'
    });

    // Update page title
    document.title = `${code.toUpperCase()} - PESU LMS`;

  } catch (error) {
    console.error('Subject route error:', error);
    throw error;
  }
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
    document.title = title ? `${title} | PESU LMS` : 'PDF Viewer | PESU LMS';

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
    /^\/subject\/.+/,        // /subject/:code
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
  router.on('/subject/:code', handleSubjectRoute, { requiresAuth: true });
  router.on('/pdf-viewer', handlePDFViewerRoute, { requiresAuth: true });
  router.on('/download', () => {}, { requiresAuth: true });
  router.on('/upload', () => {}, { requiresAuth: true });

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

