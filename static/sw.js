const CACHE_NAME = 'pesu-bca-v2.4.0';
const OFFLINE_URL = '/offline.html';

// Files to cache immediately
const STATIC_ASSETS = [
  '/',
  // CSS files
  '/css/main.css',
  '/css/login_form.css',
  '/css/loading_animation.css',
  '/css/index.css',
  '/css/alerts.css',
  '/css/forms.css',
  '/css/admin.css',
  '/css/list_counter.css',
  // JavaScript files
  '/js/login.js',
  '/js/analytics-preferences.js',
  '/js/main.js',
  '/js/openLinkHandler.js',
  '/js/utils.js',
  '/js/common-init.js',
  '/js/form.js',
  '/js/pdf-nav.js',
  '/js/themetoggle.js',
  // Theme JavaScript files
  '/js/codeblock.js',
  '/js/toc.js',
  '/js/note.js',
  '/js/searchElasticlunr.min.js',
  // Icons
  '/icons/search.svg',
  '/icons/sun.svg',
  '/icons/moon.svg',
  // PWA files
  '/manifest.json',
  '/android-chrome-192x192.png',
  '/android-chrome-512x512.png',
  '/apple-touch-icon.png',
  '/favicon-16x16.png',
  '/favicon-32x32.png',
  // PDF.js viewer files
  '/pdfjs/web/viewer.html',
  '/pdfjs/build/pdf.mjs',
  '/pdfjs/build/pdf.worker.mjs',
  '/pdfjs/web/viewer.mjs',
  '/pdfjs/web/viewer.css',
  OFFLINE_URL
];

console.log('[SW] Script loaded');
self.addEventListener('error', e => console.error('[SW] Error event:', e));
self.addEventListener('unhandledrejection', e => console.error('[SW] Unhandled rejection:', e.reason));

// Install event - cache static assets (with detailed logging)
self.addEventListener('install', event => {
  self.skipWaiting()
  console.log('[SW] Install event triggered');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async cache => {
        console.log('[SW] Caching static assets (robust mode)...');
        for (const url of STATIC_ASSETS) {
          try {
            const req = new Request(url, { cache: 'no-cache' });
            const res = await fetch(req);
            if (res && res.ok) {
              await cache.put(req, res.clone());
              console.log(`[SW] Cached: ${url}`);
            } else {
              console.warn(`[SW] Skipped (not ok): ${url} - status: ${res && res.status}`);
            }
          } catch (err) {
            console.error(`[SW] Failed to fetch/cache: ${url}`, err);
          }
        }
        console.log('[SW] Static asset caching complete');
      })
      .then(() => {
        console.log('[SW] Service Worker installed');
        return self.skipWaiting();
      })
      .catch(err => {
        console.error('[SW] Install failed:', err);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  console.log('[SW] Activate event triggered');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('[SW] Service Worker activated');
      return self.clients.claim();
    })
  );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', event => {
  // Skip non-GET or external requests
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) {
    return;
  }

  const url = new URL(event.request.url);
  
  // Never cache index.html or subject.html - always fetch fresh
  if (url.pathname.endsWith('/index.html') || 
      url.pathname.endsWith('/subject.html') ||
      url.pathname === '/' ||
      url.pathname.match(/\/sem-\d+\/[^/]+\/?$/)) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(event.request).then(response => {
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }

          const responseToCache = response.clone();

          // Cache CSS, JS and images dynamically (avoid caching PDFs or large unknown files)
          if (
            event.request.url.includes('/css/') ||
            event.request.url.includes('/js/') ||
            event.request.destination === 'image'
          ) {
            caches.open(CACHE_NAME)
              .then(cache => cache.put(event.request, responseToCache))
              .catch(err => console.error('[SW] Failed to cache dynamic asset:', event.request.url, err));
          }

          return response;
        });
      })
      .catch(() => {
        if (event.request.destination === 'document') {
          return caches.match(OFFLINE_URL);
        }
      })
  );
});

// Background sync for offline actions
self.addEventListener('sync', event => {
  if (event.tag === 'background-sync') {
    event.waitUntil(doBackgroundSync());
  }
});

function doBackgroundSync() {
  // Handle offline actions when back online
  return Promise.resolve();
}

// Push notification support with custom icons
self.addEventListener('push', event => {
  if (event.data) {
    const options = {
      body: event.data.text(),
      icon: '/android-chrome-192x192.png',
      badge: '/favicon-32x32.png',
      vibrate: [200, 100, 200],
      tag: 'pesu-bca-notification',
      requireInteraction: false
    };

    event.waitUntil(
      self.registration.showNotification('PESU BCA LMS', options)
    );
  }
});

// Refresh cached assets when requested (e.g., on page load)
async function refreshCachedAssetsOnDemand() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const requests = await cache.keys();
    const origin = self.location.origin;

    // Helper to decide which cached requests to refresh. We limit to
    // typical static asset extensions to avoid re-downloading large binaries like PDFs.
    const refreshExt = /\.(css|js|json|png|jpg|jpeg|svg|ico|html)$/i;

    const refreshPromises = requests.map(async (req) => {
      try {
        if (!req.url.startsWith(origin)) return false;
        // Only GETs
        if (req.method && req.method !== 'GET') return false;
        // Skip opaque/foreign requests
        const path = req.url.replace(origin, '');
        if (!refreshExt.test(path)) return false;

        // Fetch fresh version bypassing browser cache
        const fresh = await fetch(req, { cache: 'no-cache', credentials: 'same-origin' });
        if (fresh && fresh.ok) {
          await cache.put(req, fresh.clone());
          return true;
        }
      } catch (e) {
        console.warn('[SW] refresh failed for', req.url, e);
      }
      return false;
    });

    const results = await Promise.all(refreshPromises);
    const succeeded = results.filter(Boolean).length;
    console.log(`[SW] refreshCachedAssetsOnDemand: refreshed ${succeeded}/${results.length} assets`);

    // Notify clients that refresh completed
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    for (const c of clients) {
      c.postMessage({ type: 'CACHE_REFRESHED', refreshed: succeeded, total: results.length });
    }
    return { refreshed: succeeded, total: results.length };
  } catch (err) {
    console.error('[SW] refreshCachedAssetsOnDemand error', err);
    return { error: String(err) };
  }
}

// Listen for messages from pages (e.g. trigger refresh on page load)
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data && data.type === 'REFRESH_ON_LOAD') {
    // Run refresh but don't block message handling
    event.waitUntil(refreshCachedAssetsOnDemand());
  }
});
