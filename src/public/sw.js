/* =========================================================================
 * sw.js — service worker for the Student Grading Portal PWA (built output).
 *
 * Served from /student-grading-portal-web/sw.js. Strategy:
 *   - App shell + static assets: cache-first (with network fallback on miss).
 *   - Large hashed JS/CSS chunks: cache-first too (immutable, content-hashed).
 *   - RAG index (faa_index.json) + any API / chat endpoint: network-first,
 *     never served stale.
 *
 * Bump the CACHE name on every deploy (paired with main.js __APP_VERSION__)
 * so users never run stale JS.
 * ========================================================================= */
const CACHE = 'grading-portal-v' + __APP_VERSION__;

// The core shell to pre-cache on install. Vite emits hashed names, so instead
// of hard-coding them we cache-on-fetch (stale-while-revalidate below). The
// manifest + icons are stable and worth pre-caching.
const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

function isNoCache(url) {
  return /faa_index\.json|faaRag\.js|v1\/chat|api/i.test(url);
}

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = e.request.url || '';
  // Never serve a stale RAG index / API from cache -- go straight to network.
  if (isNoCache(url)) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request).then(r => r || caches.match('./'))));
    return;
  }
  // Cache-first for static assets; populate the cache as new hashed chunks arrive.
  e.respondWith(
    caches.match(e.request).then(cached => {
      const network = fetch(e.request).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
