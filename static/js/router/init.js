/**
 * Router initialization script
 * Add this to base.html as a module script to enable CSR navigation
 */

console.log('[Router Init] Module loading...');

// Use a global flag to avoid multiple router creations on the same page
const globalRouter = window.appRouter || window.__appRouterInstance;
if (globalRouter) {
  window.appRouter = globalRouter;
  console.log('[Router Init] Router already initialized, skipping');
} else {
  import('./index.js').then(module => {
    const Router = module.default;
    return import('./handlers.js').then(handlersModule => {
      const { setupRouter } = handlersModule;
      
      // Initialize router once DOM is ready
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initRouter);
      } else {
        initRouter();
      }

      function initRouter() {  
        try {
          // Create and setup router
          const router = setupRouter(Router);

          // Expose router to window for debugging and manual navigation
          window.appRouter = router;
          window.__appRouterInstance = router;

          // Log router navigation for debugging (remove in production)
          const originalPush = router.push.bind(router);
          router.push = async function(pathname, state) {
            console.log('[Router] → Navigating to:', pathname);
            try {
              await originalPush(pathname, state);
              console.log('[Router] ✓ Navigation successful to:', pathname);
            } catch (error) {
              console.error('[Router] ✗ Navigation failed:', error);
              throw error;
            }
          };
          
          console.log('[CSR Router] ✓ Initialized successfully');
        } catch (error) {
          console.error('[Router Init] ✗ Initialization failed:', error);
          throw error;
        }
      }
    });
  }).catch(error => {
    console.error('[Router Init] ✗ Module import failed:', error);
  });
}
