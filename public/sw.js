// FindMYJob minimal service worker
// Caches offline.html and icons during install;
// on fetch, only intercepts page navigation requests —
// falls back to offline.html when network fails.
// API responses, assets and authenticated pages are never cached
// (they carry Cache-Control: no-store / private).

const CACHE_NAME = 'findmyjob-static-v1'
const PRECACHE_URLS = [
  '/offline.html',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
      ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  // Only intercept full-page navigation requests.
  // All other requests (API, assets, XHR) go straight to the network.
  if (event.request.mode !== 'navigate') return

  event.respondWith(
    fetch(event.request).catch(() =>
      caches
        .match('/offline.html')
        .then((r) => r ?? new Response('Offline', { status: 503 })),
    ),
  )
})
