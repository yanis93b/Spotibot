/*
 * SpotiBot Service Worker
 * ------------------------
 * - Cache name: spotibot-v1
 * - Install: pre-cache the app shell (/, /signin, logo, favicons, manifest)
 * - Fetch: cache-first for same-origin GET requests, fall back to network,
 *          cache new successful responses.
 * - Skips:  /api/* (including audio & cover streams), non-GET requests,
 *           cross-origin requests.
 * - Activate: delete any caches that are not the current one.
 */

const CACHE_NAME = 'spotibot-v1';

const APP_SHELL = [
  '/',
  '/signin',
  '/logo.svg',
  '/favicon-32.png',
  '/apple-touch-icon.png',
  '/spotibot-brand.png',
  '/manifest.json',
];

// ---------------------------------------------------------------------------
// Install: pre-cache the app shell, then activate immediately.
// ---------------------------------------------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        // addAll is all-or-nothing; ignore individual failures so a missing
        // asset doesn't break the whole install.
        Promise.all(
          APP_SHELL.map((url) =>
            cache.add(url).catch((err) => {
              console.warn('[SW] Skipping precache for', url, err);
            })
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

// ---------------------------------------------------------------------------
// Activate: purge old caches and take control of clients.
// ---------------------------------------------------------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => {
              console.log('[SW] Deleting old cache:', key);
              return caches.delete(key);
            })
        )
      )
      .then(() => self.clients.claim())
  );
});

// ---------------------------------------------------------------------------
// Fetch: cache-first with network fallback + runtime caching.
// ---------------------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET requests.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Skip API routes — this covers /api/audio/*, /api/cover/*, /api/track/*/audio,
  // /api/track/*/cover and every other data endpoint. These must always hit the
  // network (or fail) and should never be served from cache.
  if (url.pathname.startsWith('/api/')) return;

  // Skip cross-origin requests (analytics, fonts, CDNs, etc.).
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached;
      }

      return fetch(request)
        .then((response) => {
          // Only cache valid, same-origin basic responses (status 200).
          if (
            !response ||
            response.status !== 200 ||
            response.type !== 'basic'
          ) {
            return response;
          }

          // Clone before consuming — one for cache, one for the browser.
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, clone);
          });

          return response;
        })
        .catch(() => {
          // Offline fallback: for navigation requests, serve the cached root
          // so the app shell can boot and show an offline state.
          if (request.mode === 'navigate') {
            return caches.match('/');
          }
          // For everything else, respond with a 503.
          return new Response('Offline', {
            status: 503,
            statusText: 'Offline',
            headers: { 'Content-Type': 'text/plain' },
          });
        });
    })
  );
});

// ---------------------------------------------------------------------------
// Allow the page to trigger an immediate activation on update.
// ---------------------------------------------------------------------------
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
