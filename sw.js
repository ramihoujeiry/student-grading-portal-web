/* =========================================================================
 * sw.js — service worker for the Student Grading Portal PWA (built output).
 *
 * Served from /student-grading-portal-web/sw.js. Strategy:
 *   - HTML (index.html, navigation): NETWORK-FIRST — always get fresh.
 *     This prevents stale app shell from breaking new deploys.
 *   - Static assets (JS/CSS/images): cache-first with short TTL.
 *   - RAG index + API endpoints: network-first, never cached.
 *
 * The SW aggressively skips waiting and claims clients on every deploy
 * so an old SW never persists across versions.
 * ========================================================================= */
const CACHE = 'grading-portal-v' + "mtm20xxy";
const CACHE_TTL = 24 * 60 * 60 * 1000; // 1 day

// Only pre-cache stable assets. Everything else is cache-on-fetch.
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

function isHTML(url) {
  return url.includes('.html') || url.endsWith('/') || /\/[^.]*$/.test(url.split('?')[0]);
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

  // CROSS-ORIGIN: bypass entirely (Firebase, APIs, AI proxy)
  if (url.includes('googleapis.com') || url.includes('googleusercontent.com') ||
      url.includes('firebaseio.com') || url.includes('gstatic.com') ||
      (url.startsWith('http') && !url.includes(self.location.host))) {
    return;
  }

  // Never cache RAG/API
  if (isNoCache(url)) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }

  // HTML: network-first (always fresh app shell)
  if (isHTML(url)) {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html')))
    );
    return;
  }

  // Static assets: cache-first with TTL check
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) {
        // Check TTL
        const dateHeader = cached.headers.get('date');
        if (dateHeader) {
          const age = Date.now() - new Date(dateHeader).getTime();
          if (age > CACHE_TTL) {
            // Stale — fetch fresh in background
            fetch(e.request).then(res => {
              if (res && res.status === 200) {
                caches.open(CACHE).then(c => c.put(e.request, res.clone()));
              }
            }).catch(() => {});
          }
        }
        return cached;
      }
      // Not in cache — fetch and cache
      return fetch(e.request).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      }).catch(() => new Response('Offline', { status: 503 }));
    })
  );
});
