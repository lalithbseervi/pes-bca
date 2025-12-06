/**
 * Router initialization script
 * Add this to base.html as a module script to enable CSR navigation
 */

import Router from '/js/router/index.js?v={{ config.extra.sw_version }}';
import { setupRouter } from '/js/router/handlers.js?v={{ config.extra.sw_version }}';

// Initialize router once DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initRouter);
} else {
  initRouter();
}

function initRouter() {
  // Create and setup router
  const router = setupRouter(Router);

  // Expose router to window for debugging and manual navigation
  window.appRouter = router;

  console.log('CSR Router initialized');
  
  // Log router navigation for debugging (remove in production)
  const originalPush = router.push.bind(router);
  router.push = async function(pathname, state) {
    console.log('[Router] Navigating to:', pathname);
    try {
      await originalPush(pathname, state);
      console.log('[Router] Navigation successful');
    } catch (error) {
      console.error('[Router] Navigation failed:', error);
      throw error;
    }
  };
}
