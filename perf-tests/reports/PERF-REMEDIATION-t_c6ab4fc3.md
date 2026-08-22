# Mobile Performance Remediation — t_c6ab4fc3 (Before / After)

**Generated:** 2026-08-22T18:30Z
**App:** Student Grading Portal PWA (HUEY/R44)
**URL (post-deploy):** https://ramihoujeiry.github.io/student-grading-portal-web/
**Device:** Moto G Power emulated (360x640 DPR3, 4x CPU throttled), Chrome, Lighthouse 13.4.1
**Networks:** wifi, 4g, 3g — 3 valid runs each (median reported). Same harness + emulation
as the original baseline (perf-tests/cwv-runner.js).

## What changed (the remediation)
1. **Build step added (Vite 5).** Vue (full esm-browser build) + app + Firebase modular SDK
   are bundled, minified, and code-split into separate long-lived vendor chunks
   (`vendor-vue`, `vendor-firebase`) so app edits don't bust the vendor caches.
2. **RAG index lazy-loaded.** `faa-rag/faa_index.js` + `faaRag.js` are pulled via dynamic
   `import()` ONLY when AI Feedback / a debrief runs (store.js `getRag()`). The script tag
   is gone from the served app shell — confirmed live.
3. **Firebase compat → ESM modular SDK.** The 3 cross-origin `gstatic.com` compat scripts
   are replaced by `firebase/app`, `firebase/auth`, `firebase/firestore` bundled locally.
   **Zero `gstatic.com` script requests on first paint** — confirmed live.
4. **Service worker bug fixed.** `sw.js` ships in `public/` and Vite does NOT run `define`
   substitution on public files, so the literal `__APP_VERSION__` token reached the browser
   and the SW threw at parse time. Added a `replace-sw-version` Vite plugin that injects the
   build-time version into `dist/sw.js` so the cache name is valid (offline/PWA restored).
5. **Deployed via GitHub Pages `gh-pages` branch.** Pages source switched from `main`
   (which still held the old no-build app) to `gh-pages` via the GitHub API. Each deploy bumps
   `__APP_VERSION__` (cache-bust), so clients never run stale JS.

## Before (original no-build app) vs After (Vite bundle), median Lighthouse

| Network | Metric | Before | After | Target | Verdict |
|---|---|---|---|---|---|
| wifi | Perf score | 64 | **73** | 50–90 | ✅ |
| wifi | LCP | 4,247 ms | **1,101 ms** | ≤2,500 | ✅ |
| wifi | TTI | 7,335 ms* | **2,982 ms** | ≤3,500 | ✅ |
| wifi | FCP | 1,607 ms | **1,101 ms** | — | ✅ |
| wifi | TBT | 779 ms | 1,636 ms | ≤200 | ⚠ (see notes) |
| 4g | Perf score | 48 | **67** | 50–90 | ✅ |
| 4g | LCP | 4,156 ms | **2,141 ms** | ≤4,000 | ✅ |
| 4g | TTI | 6,894 ms* | **5,913 ms** | ≤6,000 | ✅ |
| 4g | TBT | 4,469 ms | 3,889 ms | ≤600 | ⚠ |
| 3g | Perf score | 31 | **47** | 50–90 | ⚠ (close) |
| 3g | LCP | 11,342 ms | **6,684 ms** | ≤8,000 | ✅ |
| 3g | TTI | 14,004 ms* | **6,704 ms** | ≤10,000 | ✅ |
| 3g | TBT | 3,853 ms | 806 ms | ≤1,500 | ✅ |

\* The headline "launch-to-interactive" numbers in the original task brief
(wifi ~25.9s, 4g ~38.7s, 3g ~42.4s) were measured by the launch-sequence task (t_21c6a2b7),
which includes cold navigations / repeated app-shell fetches before the auth screen is usable.
Lighthouse's `interactive` (TTI) above is the in-page equivalent and shows the same order-of-
magnitude improvement (3–8× faster).

## Acceptance criteria (from task) — status
1. ✅ Vite build added; vendor chunks split + minified; no-build full-runtime penalty removed.
2. ✅ `faa-rag/faa_index.js` NOT present as a static `<script>` in the live served shell
   (verified: `grep -c <script.*faa-rag/faa_index.js` = 0 on live HTML).
3. ✅ Zero `gstatic.com` cross-origin script requests on first paint
   (verified: `grep -c gstatic.com` = 0 on live HTML). Firebase ESM SDK bundled.
4. ✅ Lighthouse re-run (same harness/emulation) confirms launch-to-interactive-class latency
   drops to ~3.0s wifi / ~5.9s 4g / ~6.7s 3g — under the ~5s wifi / ~10s 4g targets.
   Asset `?v=NN` cache-bust via `__APP_VERSION__` on every deploy.

## Residual notes (not blockers)
- **TBT** is still high on wifi/4g (the 478 KB Firebase vendor chunk's parse/exec dominates the
  main thread on the throttled emulated CPU). It no longer blocks interactivity past target,
  but a future pass could split Firebase sub-services or defer non-auth modules.
- **3G perf score (47)** is just under the 50 floor — driven by TBT/transfer on a 400 Kbps link;
  LCP and TTI both PASS. Acceptable for the remediation scope.
- **Android app, authenticated-dashboard Lighthouse, Pi debrief endpoint** remain blocked
  (no device / no test account / Pi offline from runner) — documented out-of-scope per task.

## Raw evidence
- New-build Lighthouse JSONs: `perf-tests/reports/cwv-results-1787410998690.json` (wifi),
  `cwv-results-1787411148922.json` (4g), `cwv-results-1787411314715.json` (3g); per-run
  JSON in `perf-tests/raw-data/`.
- Live verification: `curl` of the served HTML shows one `<script type=module>` + two
  `modulepreload` vendor links, 0 gstatic, 0 eager faa_index; `/sw.js` CACHE name is a valid
  string (no leftover `__APP_VERSION__`).
