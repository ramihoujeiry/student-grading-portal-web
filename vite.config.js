import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

// Vite does NOT run `define` substitutions over files copied from publicDir
// (such as sw.js). Inject the build-time version token into the emitted
// dist/sw.js so the service worker's cache name is valid (otherwise the SW
// throws ReferenceError at parse time and offline/PWA support silently dies).
function replaceSwVersion() {
  return {
    name: 'replace-sw-version',
    apply: 'build',
    closeBundle() {
      const swPath = fileURLToPath(new URL('./dist/sw.js', import.meta.url));
      if (!existsSync(swPath)) return;
      const ver = Date.now().toString(36);
      const src = readFileSync(swPath, 'utf8').replace(/__APP_VERSION__/g, JSON.stringify(ver));
      writeFileSync(swPath, src);
    }
  };
}

// ---------------------------------------------------------------------------
// Build config for the Student Grading Portal web app.
//
// Goals (perf remediation t_c6ab4fc3):
//   1. Bundle Vue + app + Firebase into minified, code-split chunks.
//   2. Keep the RAG index (faa-rag) out of the cold path — it is loaded via a
//      dynamic import() ONLY when AI Feedback / debrief opens.
//   3. Firebase ships as the ESM modular SDK (bundled locally) — no gstatic.com
//      cross-origin scripts on first paint.
//   4. Serve from the GitHub Pages sub-path /student-grading-portal-web/.
// ---------------------------------------------------------------------------
export default defineConfig({
  root: 'src',
  base: '/student-grading-portal-web/',
  // Injected at build time (bump this string each deploy so the SW + browser
  // caches are busted and clients never serve stale JS).
  define: {
    __APP_VERSION__: JSON.stringify(Date.now().toString(36))
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2020',
    // Never inline the RAG index or any asset into a JS chunk — keep them as
    // their own cacheable files so the lazy dynamic import() stays lazy.
    assetsInlineLimit: 0,
    sourcemap: false,
    rollupOptions: {
      output: {
        // Split the heavy vendors into their own long-lived chunks so app
        // code changes don't bust the Firebase / Vue caches.
        manualChunks: {
          'vendor-vue': ['vue'],
          'vendor-firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore']
        }
      }
    }
  },
  resolve: {
    alias: {
      // We keep the Vue template in index.html (in-DOM template), so we need
      // the FULL Vue build that includes the template compiler. The default
      // 'vue' import for bundlers is runtime-only and would fail to compile
      // the in-DOM template. (CSP keeps 'unsafe-eval' for the compiler.)
      vue: fileURLToPath(new URL('./node_modules/vue/dist/vue.esm-browser.prod.js', import.meta.url))
    }
  },
  plugins: [replaceSwVersion()],
  server: {
    port: 5173
  }
});
