// No-op service worker for the Playwright fixture.
// The real app registers 'sw.js' on mount (offline/PWA support), and the
// fixture server would otherwise answer /sw.js with 404 — which the smoke
// specs treat as a page error. Serving this stub keeps the console clean.
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });
