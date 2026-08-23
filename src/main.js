/* =========================================================================
 * main.js — single ESM entry point for the Student Grading Portal PWA.
 *
 * Vite bundles this: Vue (full build w/ template compiler), the modular
 * Firebase SDK, the data layer (store.js) and the app (app.js) are all
 * code-split into minified chunks. The FAA RAG index is NEVER imported here —
 * store.js dynamic-imports it only when a debrief actually runs.
 *
 * All assets are served from the GitHub Pages sub-path
 * /student-grading-portal-web/ (see vite.config.js `base`).
 * ========================================================================= */
import { app } from './app.js';

// Mount into the in-DOM template (#app) defined in index.html.
app.mount('#app');

// Expose the mounted component instance for debugging/automation (same intent
// as window.__app in app.js; prod Vue builds don't keep _instance reachable).
window.__vm = app._container && app._container._vnode
  ? app._container._vnode.component?.proxy ?? null
  : null;

// Register the service worker for offline/PWA support (path is relative to the
// deployed base, so it resolves correctly under /student-grading-portal-web/).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js?v=' + __APP_VERSION__).catch(() => {});
  });
}
