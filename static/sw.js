const CACHE_NAME = 'pesu-bca-v1.0.0';
const OFFLINE_URL = '/offline.html';

// Files to cache immediately
const STATIC_ASSETS = [
  '/',
  '/css/main.css',
  '/css/login_form.css',
  '/css/loading_animation.css',
  '/css/index.css',
  '/js/login.js',
  '/js/analytics-preferences.js',
  '/js/main.js',
  '/js/openLinkHandler.js',
  '/manifest.json',
  '/android-chrome-192x192.png',
  '/android-chrome-512x512.png',
  '/apple-touch-icon.png',
  '/favicon-16x16.png',
  '/favicon-32x32.png',
  OFFLINE_URL
];

console.log('[SW] Script loaded');
self.addEventListener('error', e => console.error('[SW] Error event:', e));
self.addEventListener('unhandledrejection', e => console.error('[SW] Unhandled rejection:', e.reason));

// Install event - cache static assets (with detailed logging)
self.addEventListener('install', event => {
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
