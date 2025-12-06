/**
 * Lightweight Client-Side Router for Progressive Enhancement
 * Handles smooth navigation without full page reloads
 */

class Router {
  constructor(options = {}) {
    this.routes = new Map();
    this.currentRoute = null;
    this.middleware = [];
    this.scrollPosition = { x: 0, y: 0 };
    this.transitionDuration = options.transitionDuration || 300;
    this.contentSelector = options.contentSelector || 'main, #main, .main-content';
    this.activeClass = options.activeClass || 'active';
    
    this.init();
  }

  init() {
    // Listen for back/forward button
    window.addEventListener('popstate', (e) => {
      this.handlePopState(e);
    });

    // Intercept link clicks
    document.addEventListener('click', (e) => {
      this.handleLinkClick(e);
    });

    // Store scroll position before navigation
    window.addEventListener('beforeunload', () => {
      this.scrollPosition = {
        x: window.scrollX,
        y: window.scrollY
      };
    });
  }

  /**
   * Register a route with pattern and handler
   * Pattern supports: /path, /path/:param, /path/*
   * @param {string} pattern - URL pattern
   * @param {Function} handler - Route handler function
   * @param {Object} options - Route options (requiresAuth: boolean)
   */
  on(pattern, handler, options = {}) {
    const regex = this.patternToRegex(pattern);
    this.routes.set(pattern, { 
      regex, 
      handler, 
      pattern,
      requiresAuth: options.requiresAuth === true
    });
    return this;
  }

  /**
   * Convert route pattern to regex
   * /subject/:code -> /subject/([^/]+)
   * /pdf-viewer -> /pdf-viewer
   * /files/* -> /files/.*
   */
  patternToRegex(pattern) {
    const escaped = pattern
      .replace(/\//g, '\\/')
      .replace(/:(\w+)/g, '(?<$1>[^/]+)')
      .replace(/\*/g, '.*');
    
    return new RegExp(`^${escaped}$`);
  }

  /**
   * Extract parameters from URL based on pattern
   */
  extractParams(pathname, pattern) {
    const regex = this.patternToRegex(pattern);
    const match = pathname.match(regex);
    
    if (!match) return null;
    return match.groups || {};
  }

  /**
   * Find matching route for pathname
   */
  matchRoute(pathname) {
    for (const [pattern, route] of this.routes) {
      if (route.regex.test(pathname)) {
        const params = this.extractParams(pathname, pattern);
        return { ...route, params };
      }
    }
    return null;
  }

  /**
   * Handle link clicks - intercept if it's a routed URL
   */
  handleLinkClick(e) {
    const link = e.target.closest('a[href]');
    if (!link) return;

    const href = link.getAttribute('href');
    console.log('[Router] Link clicked:', href);
    
    // Ignore external links, mailto, tel, etc.
    if (!href.startsWith('/') || href.startsWith('//')) {
      console.log('[Router] Ignoring external/protocol link:', href);
      return;
    }
    
    // Ignore if user is holding modifier keys
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      console.log('[Router] Ignoring link (modifier key held)');
      return;
    }

    // Strip query params for route matching, but preserve full URL for navigation
    const pathOnly = href.split('?')[0];
    const route = this.matchRoute(pathOnly);
    if (!route) {
      console.log('[Router] No matching route, using browser navigation:', href);
      return; // Let browser handle it (SSR fallback)
    }

    console.log('[Router] Route matched, intercepting navigation:', href);
    e.preventDefault();
    this.push(href);
  }

  /**
   * Navigate to a route
   */
  async push(pathname, state = {}) {
    const route = this.matchRoute(pathname);
    
    if (!route) {
      // No CSR route, fall back to full page navigation
      window.location.href = pathname;
      return;
    }

    // Run middleware
    for (const mw of this.middleware) {
      const result = await mw(pathname, route);
      if (result === false) return; // Middleware rejected
    }

    try {
      // Save scroll position
      this.scrollPosition = {
        x: window.scrollX,
        y: window.scrollY
      };

      // Check auth if route requires it
      if (route.requiresAuth) {
        const authModule = typeof window.auth !== 'undefined' ? window.auth : null;
        if (authModule) {
          const isAuth = await authModule.requireAuth(pathname, route);
          if (!isAuth) {
            console.log('[Router] Navigation blocked by auth middleware');
            return; // Block navigation
          }
        }
      }

      // Handle route
      await route.handler(route.params, pathname);

      // Update browser history
      const stateObj = { 
        pathname, 
        scrollPosition: this.scrollPosition,
        ...state 
      };
      window.history.pushState(stateObj, '', pathname);

      this.currentRoute = pathname;
      this.updateActiveLinks(pathname);
      this.scrollToTop();
    } catch (error) {
      console.error('Router error:', error);
      // Fall back to full page reload on error
      window.location.href = pathname;
    }
  }

  /**
   * Go back in history
   */
  back() {
    window.history.back();
  }

  /**
   * Handle browser back/forward
   */
  async handlePopState(e) {
    const pathname = window.location.pathname;
    const route = this.matchRoute(pathname);

    if (!route) {
      // No CSR route, full page reload
      window.location.reload();
      return;
    }

    try {
      // Check auth if route requires it
      if (route.requiresAuth) {
        const authModule = typeof window.auth !== 'undefined' ? window.auth : null;
        if (authModule) {
          const isAuth = await authModule.requireAuth(pathname, route);
          if (!isAuth) {
            console.log('[Router] PopState blocked by auth');
            return;
          }
        }
      }

      await route.handler(route.params, pathname);
      this.currentRoute = pathname;
      this.updateActiveLinks(pathname);

      // Restore scroll position
      if (e.state?.scrollPosition) {
        setTimeout(() => {
          window.scrollTo(e.state.scrollPosition.x, e.state.scrollPosition.y);
        }, 0);
      } else {
        this.scrollToTop();
      }
    } catch (error) {
      console.error('Router popstate error:', error);
      window.location.reload();
    }
  }

  /**
   * Update active link styling
   */
  updateActiveLinks(pathname) {
    document.querySelectorAll('a[href]').forEach(link => {
      const href = link.getAttribute('href');
      const isActive = href === pathname || pathname.startsWith(href + '/');
      
      if (isActive) {
        link.classList.add(this.activeClass);
      } else {
        link.classList.remove(this.activeClass);
      }
    });
  }

  /**
   * Scroll to top with smooth behavior
   */
  scrollToTop() {
    setTimeout(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 0);
  }

  /**
   * Add middleware function
   */
  use(middleware) {
    this.middleware.push(middleware);
    return this;
  }

  /**
   * Get content element for rendering
   */
  getContentElement() {
    const selectors = this.contentSelector.split(',').map(s => s.trim());
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) return element;
    }
    return document.body;
  }

  /**
   * Update page content with fade effect
   */
  async updateContent(html) {
    const container = this.getContentElement();
    
    // Create temporary container
    const temp = document.createElement('div');
    temp.innerHTML = html;
    
    // Fade out
    container.style.opacity = '0';
    container.style.transition = `opacity ${this.transitionDuration}ms ease-in-out`;
    
    await new Promise(resolve => setTimeout(resolve, this.transitionDuration));
    
    // Update content
    container.innerHTML = temp.innerHTML;
    
    // Fade in
    container.style.opacity = '1';
    
    await new Promise(resolve => setTimeout(resolve, this.transitionDuration));
    container.style.transition = '';
  }

  /**
   * Get current route info
   */
  getCurrentRoute() {
    return this.currentRoute;
  }
}

// Export for use in templates
export default Router;
