const CACHE_NAME = 'taskflow-cache-v1';

// List core assets. Add firebase scripts if you want them cached for offline start.
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js'
];

// Install: pre-cache core.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: cleanup old caches.
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: network-first for Firestore calls, cache-first for static.
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Let Firestore / dynamic API calls go network-first; skip caching writes
  if (url.hostname.includes('firestore.googleapis.com')) {
    return; // default network
  }

  // Static strategy: try cache, then network, fallback to cached index.html for navigation
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          // Optionally update cache
          const copy = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
  } else {
    event.respondWith(
      caches.match(event.request)
        .then(cacheRes => cacheRes ||
          fetch(event.request).then(netRes => {
            // Optionally cache new static assets (e.g. icons)
            if (netRes.ok && (event.request.url.endsWith('.png') || event.request.url.endsWith('.js'))) {
              const copy = netRes.clone();
              caches.open(CACHE_NAME).then(c => c.put(event.request, copy));
            }
            return netRes;
          }).catch(() => {
            // Fallback logic: return nothing or a placeholder response
          })
        )
    );
  }
});
