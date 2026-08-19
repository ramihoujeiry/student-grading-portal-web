const CACHE = 'grading-portal-v52';
const ASSETS = [
  './',
  'index.html',
  'app.js?v=52',
  'store.js?v=52',
  'seed.js?v=52',
  'firebase-config.js?v=52',
  'vue.global.prod.js?v=52',
  'faa-rag/faaRag.js?v=52',
  'faa-rag/faa_index.json?v=52',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

// Never cache the live RAG index or any API/JSON at runtime -- always fresh.
function isNoCache(url) {
  return /faa_index\.json|faaRag\.js|v1\/chat|api/i.test(url);
}

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // network-first for the shell, cache-first for static assets
  if (e.request.method !== 'GET') return;
  const url = e.request.url || '';
  // Never serve a stale RAG index / API from cache -- go straight to network.
  if (isNoCache(url)) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request).then(r => r || caches.match('./'))));
    return;
  }
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('./')))
  );
});
