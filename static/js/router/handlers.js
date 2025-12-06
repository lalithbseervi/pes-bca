/**
 * Route Handlers for CSR Navigation
 * Handles subject pages, PDF viewer, and other protected routes
 */

import { API_BASE_URL } from '../utils.js';
import { initSubjectPage } from '../init/subject.js';
import { initPDFViewer } from '../init/pdf-viewer.js';

/**
 * Subject page route handler (protected)
 * Subject pages already have SSR routes in Zola, so we do full page navigation
 */
export async function handleSubjectRoute(params, pathname) {
  let code = params.code;
  
  if (!code) throw new Error('Subject code required');
  
  console.log('[Router] Subject route handler - code:', code, 'pathname:', pathname);

  // Since subject pages are SSR-rendered by Zola (content/sem-X/*.md files),
  // we do a full page navigation instead of CSR. This ensures:
  // 1. The subject.html template is properly loaded with correct subject_code
  // 2. All inline scripts execute with the correct subject context
  // 3. Proper page styling and structure are maintained
  console.log('[Router] Navigating to subject page (SSR):', pathname);
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
 * Generic page handler for SSR-rendered pages (download, upload, posts, etc.)
 * Auth is checked by the router middleware before this is called
 * For protected routes (download, upload), this only runs if user is authenticated
 */
export async function handleGenericPageRoute(params, pathname) {
  // pathname is the full URL path being navigated to
  // params contains route parameters (usually empty for these routes)
  console.log('[Router] Generic page route - auth passed, redirecting to:', pathname);
  // For SSR pages, do a full page reload to get the server-rendered content
  // Auth has already been verified by router middleware at this point
  window.location.href = pathname;
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
  router.on('/download', handleGenericPageRoute, { requiresAuth: true });
  router.on('/upload', handleGenericPageRoute, { requiresAuth: true });
  
  // Public/SSR routes - no auth required
  router.on('/', handleGenericPageRoute, { requiresAuth: false });
  router.on('/posts', handleGenericPageRoute, { requiresAuth: false });
  router.on('/contribute', handleGenericPageRoute, { requiresAuth: false });
  router.on('/status', handleGenericPageRoute, { requiresAuth: false });
  router.on('/privacy-policy', handleGenericPageRoute, { requiresAuth: false });
  router.on('/terms-of-service', handleGenericPageRoute, { requiresAuth: false });

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

