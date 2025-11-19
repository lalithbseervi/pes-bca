// Derive cache name from the sw.js URL query parameter `v` so the same
// config.extra.sw_version used by templates controls the SW cache name.
let _swVer = 'v0';
try {
  const u = new URL(self.location.href);
  _swVer = u.searchParams.get('v') || 'v0';
} catch (e) { /* ignore */ }
const CACHE_NAME = `pesu-bca-${_swVer}`;
const OFFLINE_URL = '/offline.html';

// Files to cache immediately
// Build the list at runtime so we append the dynamic version token derived
// from the service worker URL (?v=...) — this keeps the SW cache aligned
// with the templates which also use config.extra.sw_version.
const VERSIONED_ASSETS = [
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
  '/js/session-sync.js',
  '/js/themetoggle.js',
  // Theme JavaScript files
  '/js/codeblock.js',
  '/js/toc.js',
  '/js/note.js',
  '/js/searchElasticlunr.min.js'
];

// Assets we intentionally leave unversioned (images, icons, PDF.js viewer, manifest, offline)
const UNVERSIONED_ASSETS = [
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
  // PDF.js viewer files (keep unversioned to avoid changing viewer internals unexpectedly)
  '/pdfjs/build/pdf.mjs',
  '/pdfjs/build/pdf.worker.mjs',
  '/pdfjs/web/viewer.mjs',
  '/pdfjs/web/viewer.css',
  OFFLINE_URL
];

// Append the dynamic version token to the versioned assets so their cache keys
// match the templates' `?v=` query param. Keep unversioned assets as-is.
const STATIC_ASSETS = VERSIONED_ASSETS.map(p => `${p}?v=${_swVer}`).concat(UNVERSIONED_ASSETS);

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
        console.log('[SW] Caching static assets...');
        await cache.addAll(STATIC_ASSETS);
        console.log('[SW] Static assets cached');
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
  // Ensure PostHog assets are never cached
  if (event.request.url.includes('us-assets.i.posthog.com')) {
    event.respondWith(fetch(event.request, { cache: 'no-store' }));
    return;
  }

  // Skip non-GET or external requests
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) {
    return;
  }

  const url = new URL(event.request.url);

  // Bypass ALL HTML documents (navigation) so SW never wraps or touches them.
  if (event.request.destination === 'document') {
    return; // allow browser/network to handle fully
  }

  // Fully ignore pdf.js viewer & related assets: let browser fetch normally (no caching, no headers)
  // This avoids zero-byte anomalies and preserves streaming / content-length.
  if (url.pathname.startsWith('/pdfjs/')) {
    return; // do not call respondWith -> network handled outside SW
  }

  // Pass through any Range requests untouched (streaming / partial content like PDFs)
  if (event.request.headers.has('Range')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Bypass PDFs entirely (avoid wrapping which can break streaming & content-length)
  if (url.pathname.endsWith('.pdf')) {
    event.respondWith(fetch(event.request, { cache: 'no-store' }).catch(() => fetch(event.request)));
    return;
  }

  event.respondWith(
    (async () => {
      try {
        // Open cache and use a cache-first strategy: return cached assets when
        // present (fast), otherwise fetch from network and populate the cache.
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(event.request);
        if (cached) {
          const headers = new Headers(cached.headers);
          headers.set('X-Service-Worker-Cache', 'HIT');
          return new Response(cached.body, { status: cached.status || 200, statusText: cached.statusText, headers });
        }

        // Not cached — fetch from network. We use no-cache to prefer fresh content
        // from upstream (but caching behavior is controlled by our cache-busting policy).
        const networkResp = await fetch(event.request, { cache: 'no-cache' });
        if (!networkResp) return networkResp;

        // Detect Cloudflare challenge pages or other HTML-based gating responses.
        // Some Cloudflare challenges are HTML pages that can be returned with 200/403/503
        // and may confuse clients when served from a service worker cache. We read a
        // small snippet of HTML and look for known markers. If found, don't cache it
        // and mark the response so it's easier to diagnose from the browser.
        try {
          const ct = networkResp.headers.get('content-type') || '';
          if (ct.includes('text/html')) {
            const cloneForDetect = networkResp.clone();
            const textSnippet = (await cloneForDetect.text()).slice(0, 2000);
            const markers = ['Checking your browser', 'cf-browser-verification', 'cf-challenge', 'Cloudflare', 'captcha', 'Turnstile'];
            const found = markers.some(m => textSnippet.indexOf(m) !== -1);
            if (found) {
              // Remove any stale cached entry for this request to avoid re-serving challenge
              cache.delete(event.request).catch(()=>{});
              const headers = new Headers(networkResp.headers);
              headers.set('X-Service-Worker-Cache', 'BYPASS');
              headers.set('X-Service-Worker-Challenge-Detected', '1');
              return new Response(networkResp.body, { status: networkResp.status || 200, statusText: networkResp.statusText, headers });
            }
          }
        } catch (e) {
          console.warn('[SW] Challenge-detect error', e);
        }

        // If not a successful basic response, just forward (e.g., opaque, error, pdf)
        if (networkResp.status === 0 || networkResp.type !== 'basic' || networkResp.status >= 400) {
          const headers = new Headers(networkResp.headers);
          headers.set('X-Service-Worker-Cache', 'BYPASS');
          return new Response(networkResp.body, { status: networkResp.status || 200, statusText: networkResp.statusText, headers });
        }

        // Clone for caching
        const toCache = networkResp.clone();
        if (
          event.request.url.includes('/css/') ||
          event.request.url.includes('/js/') ||
          event.request.destination === 'image'
        ) {
          cache.put(event.request, toCache).catch(err => console.error('[SW] Failed dynamic cache put:', event.request.url, err));
        }
        // For HTML documents (other than viewer.html handled above), just return the original response unmodified
        if (event.request.destination === 'document') {
          return networkResp;
        }

        const headers = new Headers(networkResp.headers);
        headers.set('X-Service-Worker-Cache', 'MISS');
        return new Response(networkResp.body, { status: networkResp.status || 200, statusText: networkResp.statusText, headers });
      } catch (e) {
        if (event.request.destination === 'document') {
          const offline = await caches.match(OFFLINE_URL);
          if (offline) {
            const headers = new Headers(offline.headers);
            headers.set('X-Service-Worker-Cache', 'OFFLINE');
            return new Response(offline.body, { status: offline.status || 200, statusText: offline.statusText, headers });
          }
        }
        return new Response('Service Worker fetch error', { status: 502, headers: { 'Content-Type': 'text/plain' } });
      }
    })()
  );
});

// Refresh cached assets on demand
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

// Listen for messages from pages (e.g. trigger refresh on page load, session sync)
self.addEventListener('message', (event) => {
  const data = event.data || {};
  
  if (data && data.type === 'REFRESH_ON_LOAD') {
    // Run refresh but don't block message handling
    event.waitUntil(refreshCachedAssetsOnDemand());
  }
  
  // Handle session sync messages
  if (data && data.type === 'SESSION_SYNC') {
    const action = data.action;
    
    if (action === 'login' || action === 'refresh') {
      // Store session info in service worker scope for potential background operations
      console.log('[SW] Session sync:', action);
      event.waitUntil(handleSessionUpdate(data.session));
    } else if (action === 'logout') {
      console.log('[SW] Session cleared');
      event.waitUntil(handleSessionClear());
    }
  }
});

// Session management in service worker
let cachedSession = null;

async function handleSessionUpdate(sessionData) {
  cachedSession = sessionData;
  console.log('[SW] Session cached:', sessionData?.srn);
  
  // Notify all clients about session update
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  for (const client of clients) {
    client.postMessage({ 
      type: 'SESSION_UPDATED', 
      session: sessionData 
    });
  }
}

async function handleSessionClear() {
  cachedSession = null;
  console.log('[SW] Session cleared');
  
  // Notify all clients about session clear
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  for (const client of clients) {
    client.postMessage({ type: 'SESSION_CLEARED' });
  }
}

// Background sync for offline actions
self.addEventListener('sync', event => {
  if (event.tag === 'background-sync') {
    event.waitUntil(doBackgroundSync());
  }
});

// Function to handle background sync actions
async function doBackgroundSync() {
  // This function would handle offline actions when the device goes back online
  console.log('[SW] Background sync started');

  // Example: You could send offline form submissions here or sync data with a server
  // For now, it simply logs a message and resolves the promise.
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
      tag: 'pes-bca-notification',
      requireInteraction: false
    };

    event.waitUntil(
      self.registration.showNotification('PESU-BCA', options)
    );
  }
});
