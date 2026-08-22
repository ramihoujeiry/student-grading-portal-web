# Performance Test Results & Findings — Student Grading Portal PWA

**Generated:** 2026-08-22T13:16:55.120509Z  
**App:** Student Grading Portal PWA (HUEY/R44)  
**URL:** https://ramihoujeiry.github.io/student-grading-portal-web/  
**Device:** Moto G Power emulated (360x640 DPR3, 4x CPU), Chrome 151, Lighthouse 13.4.1  
**Networks:** wifi, 4g, 3g  
**Raw runs analyzed:** 36 (Lighthouse CWV current 18, launch/transition 9, API 9; plus 9 baseline reference runs)

> **Method.** For each metric/network we computed the **average** and **90th percentile** over all current test runs (load-time task + speed CWV task = 6 Lighthouse runs per network). Results are compared to the **approved baseline** (t_21c6a2b7) median using the plan's rule (*metric > 20% worse than baseline = regression*) and to the **target table** (PERFORMANCE_TEST_PLAN.md §8). Launch/API timings have no baseline and are reported as new measurements.

## 1. Test scope

**In scope (executed):**
- **Load time** (Lighthouse mobile emulation, cold landing / unauthenticated auth screen): FCP, LCP, TTI, TBT, Speed Index, CLS, perf score, max-potential-FID, server response.
- **Speed / responsiveness:** Core Web Vitals (same Lighthouse suite), app **launch-to-interactive** (auth screen usable), **screen transition** latency (Sign-in → Register), and **core API response times** (Firebase assets + Pi AI debrief endpoint).
- **Networks:** Wi-Fi (native), 4G (Lighthouse Slow-4G), 3G (custom 400 Kbps / 400 ms). 3 runs each, median/avg/p90 recorded.

**Out of scope (blocked on this runner, per plan §7):**
- Android app (no device/emulator/adb).
- Authenticated-dashboard Lighthouse (no Firebase test account).
- iOS/WebKit (Lighthouse cannot emulate Safari).
- Real-device farm (no BrowserStack/Sauce key).

## 2. Full consolidated results — Core Web Vitals (Lighthouse)

Values are **AVG** and **P90** across the 6 current runs per network (3 load + 3 speed-CWV). Baseline = approved median. Δ% = (avg − baseline)/baseline.

| Network | Metric | AVG | P90 | Baseline | Δ% | Regression | Target (avg) | Target (p90) |
|---|---|---|---|---|---|---|---|---|
| wifi | Perf score | 64 | 75 | 50 | +27.4% | ok | FAIL | FAIL |
| wifi | FCP (ms) | 1,607 ms | 1,939 ms | 2,138 ms | -24.8% | ok | PASS | FAIL |
| wifi | LCP (ms) | 4,247 ms | 7,288 ms | 9,626 ms | -55.9% | ok | FAIL | FAIL |
| wifi | TBT (ms) | 779 ms | 1,122 ms | 564 ms | +38.1% | REGRESSION | FAIL | FAIL |
| wifi | Speed Index (ms) | 6,754 ms | 7,712 ms | 9,106 ms | -25.8% | ok | FAIL | FAIL |
| wifi | CLS | 0.000 | 0.000 | 0.000 | - | ok | PASS | PASS |
| wifi | TTI (ms) | 7,335 ms | 8,317 ms | 9,499 ms | -22.8% | ok | FAIL | FAIL |
| wifi | maxFID (ms) | 500 ms | 588 ms | 460 ms | +8.7% | ok | FAIL | FAIL |
| wifi | Server resp (ms) | 181 ms | 230 ms | 254 ms | -28.8% | ok | n/a | n/a |
| 4g | Perf score | 48 | 56 | 34 | +39.7% | ok | FAIL | FAIL |
| 4g | FCP (ms) | 1,643 ms | 2,439 ms | 2,149 ms | -23.5% | ok | PASS | PASS |
| 4g | LCP (ms) | 4,156 ms | 5,543 ms | 7,098 ms | -41.5% | ok | FAIL | FAIL |
| 4g | TBT (ms) | 4,469 ms | 5,024 ms | 5,932 ms | -24.7% | ok | FAIL | FAIL |
| 4g | Speed Index (ms) | 11,127 ms | 13,539 ms | 21,186 ms | -47.5% | ok | FAIL | FAIL |
| 4g | CLS | 0.000 | 0.000 | 0.000 | - | ok | PASS | PASS |
| 4g | TTI (ms) | 6,894 ms | 7,673 ms | 8,352 ms | -17.5% | ok | FAIL | FAIL |
| 4g | maxFID (ms) | 1,679 ms | 1,841 ms | 2,049 ms | -18.1% | ok | FAIL | FAIL |
| 4g | Server resp (ms) | 244 ms | 445 ms | 342 ms | -28.7% | ok | n/a | n/a |
| 3g | Perf score | 31 | 35 | 44 | -28.9% | REGRESSION | FAIL | FAIL |
| 3g | FCP (ms) | 3,183 ms | 3,663 ms | 2,614 ms | +21.8% | REGRESSION | PASS | PASS |
| 3g | LCP (ms) | 11,342 ms | 13,220 ms | 3,880 ms | +192.3% | REGRESSION | FAIL | FAIL |
| 3g | TBT (ms) | 3,853 ms | 4,912 ms | 4,645 ms | -17.1% | ok | FAIL | FAIL |
| 3g | Speed Index (ms) | 27,699 ms | 35,715 ms | 29,669 ms | -6.6% | ok | FAIL | FAIL |
| 3g | CLS | 0.000 | 0.086 | 0.000 | - | ok | PASS | PASS |
| 3g | TTI (ms) | 14,004 ms | 14,307 ms | 13,979 ms | +0.2% | ok | FAIL | FAIL |
| 3g | maxFID (ms) | 1,547 ms | 1,741 ms | 1,351 ms | +14.5% | ok | FAIL | FAIL |
| 3g | Server resp (ms) | 327 ms | 640 ms | 146 ms | +124.1% | REGRESSION | n/a | n/a |

## 3. Out-of-range metrics

**20 metric/network combinations** breach a benchmark (baseline regression OR target failure):

| Network | Metric | AVG | P90 | Baseline | Δ% | Reason |
|---|---|---|---|---|---|---|
| wifi | Perf score | 64 | 75 | 50 | +27.4% | fails target (90) |
| wifi | LCP (ms) | 4,247 ms | 7,288 ms | 9,626 ms | -55.9% | fails target (2500) |
| wifi | TBT (ms) | 779 ms | 1,122 ms | 564 ms | +38.1% | >20% worse than baseline (564.3239999999987); fails target (200) |
| wifi | Speed Index (ms) | 6,754 ms | 7,712 ms | 9,106 ms | -25.8% | fails target (3400) |
| wifi | TTI (ms) | 7,335 ms | 8,317 ms | 9,499 ms | -22.8% | fails target (3500) |
| wifi | maxFID (ms) | 500 ms | 588 ms | 460 ms | +8.7% | fails target (200) |
| 4g | Perf score | 48 | 56 | 34 | +39.7% | fails target (70) |
| 4g | LCP (ms) | 4,156 ms | 5,543 ms | 7,098 ms | -41.5% | fails target (4000) |
| 4g | TBT (ms) | 4,469 ms | 5,024 ms | 5,932 ms | -24.7% | fails target (600) |
| 4g | Speed Index (ms) | 11,127 ms | 13,539 ms | 21,186 ms | -47.5% | fails target (5800) |
| 4g | TTI (ms) | 6,894 ms | 7,673 ms | 8,352 ms | -17.5% | fails target (6000) |
| 4g | maxFID (ms) | 1,679 ms | 1,841 ms | 2,049 ms | -18.1% | fails target (200) |
| 3g | Perf score | 31 | 35 | 44 | -28.9% | >20% worse than baseline (44); fails target (50) |
| 3g | FCP (ms) | 3,183 ms | 3,663 ms | 2,614 ms | +21.8% | >20% worse than baseline (2614.1220000000003) |
| 3g | LCP (ms) | 11,342 ms | 13,220 ms | 3,880 ms | +192.3% | >20% worse than baseline (3880.0110000000004); fails target (8000) |
| 3g | TBT (ms) | 3,853 ms | 4,912 ms | 4,645 ms | -17.1% | fails target (1500) |
| 3g | Speed Index (ms) | 27,699 ms | 35,715 ms | 29,669 ms | -6.6% | fails target (9000) |
| 3g | TTI (ms) | 14,004 ms | 14,307 ms | 13,979 ms | +0.2% | fails target (10000) |
| 3g | maxFID (ms) | 1,547 ms | 1,741 ms | 1,351 ms | +14.5% | fails target (300) |
| 3g | Server resp (ms) | 327 ms | 640 ms | 146 ms | +124.1% | >20% worse than baseline (146) |

## 4. Launch & screen-transition latency

Launch = time until the auth screen (email input) is interactive; transition = Sign-in → Register toggle render. No baseline exists; values are new measurements (3 runs/network).

| Network | Launch→auth (AVG) | Launch→auth (P90) | FCP (AVG) | Transition (AVG) | Transition (P90) |
|---|---|---|---|---|---|
| wifi | 25,903 ms | 30,865 ms | 3,639 ms | 803 ms | 877 ms |
| 4g | 38,708 ms | 41,177 ms | 4,481 ms | 941 ms | 1,182 ms |
| 3g | 42,422 ms | 44,129 ms | 3,872 ms | 1,120 ms | 1,450 ms |

**Read:** launch-to-interactive is the single worst user-facing number — 25.5s (Wi-Fi), ~38.6s avg (4G), ~42.4s avg (3G). Transitions themselves are fine (~0.7–1.6s).

## 5. Core API response times

**Pi AI debrief endpoint:** all 9 probes returned `error` (Pi offline → app uses offline template). Median wait 359ms (Wi-Fi) / 843ms (4G) / 429ms (3G). This is a functional/env gap, not an app perf regression — re-test on the Tailscale network.

**First-paint asset timings — AVG ms across 3 runs/network. Firebase compat scripts show `transfer 0` (cached in the reused runner profile), but parse/exec still blocks the main thread:**

| Network | Firebase compat (3 scripts total) | firebase-app | firebase-auth | firebase-firestore | vue.global | faa_index | app.js | store.js | seed.js | firebase-config |
|---|---|---|---|---|---|---|---|---|---|---|
| wifi | 8,252 | 4,008 | 1,781 | 2,463 | 658 | 928 | 523 | 352 | 682 | 1,366 |
| 4g | 5,479 | 1,377 | 734 | 3,368 | 1,438 | 1,387 | 990 | 801 | 385 | 348 |
| 3g | 7,532 | 1,543 | 1,374 | 4,614 | 1,877 | 2,098 | 867 | 858 | 539 | 695 |

*Firebase compat = 3 separate `gstatic.com` scripts (app/auth/firestore). Their combined parse/exec is the dominant blocking cost and the primary driver of the 25–44s launch time (see bottleneck #3). `faa_index.js` (~53 KB RAG KB) parses eagerly at startup even though debrief is only used post-login (bottleneck #2).


## 6. Top performance bottlenecks

**#1. No code-splitting / everything loads on first paint**
- Evidence: Cold landing ships the full app on first paint: vue.global.prod.js (~61 KB), 3 Firebase compat scripts from gstatic.com, faa_index.js (~53 KB RAG KB), store/app/seed.js. Combined with 4x CPU throttle this keeps main-thread blocked and TTI high across every network.
- Impact: Drives LCP (3G 13.1s), TBT (4G/3G ~4.5s), Speed Index (3G 19.7s p50, up to 36.9s), and the 25.5-44.0s launch-to-interactive.

**#2. faa_index.js (RAG knowledge base) loaded eagerly**
- Evidence: faa_index.js (~53 KB) is fetched and parsed at startup even though AI debrief is only used after login. api-response asset timings show it consistently among the larger first-paint scripts.
- Impact: Unnecessary ~0.5-1.9s (network-dependent) of blocking parse before the auth screen is usable; pure waste on the cold-landing path.

**#3. Firebase compat SDK pulled from gstatic.com (cross-origin, 3 scripts)**
- Evidence: api-response runs show firebase-app-compat / -auth / -firestore-compat loaded separately from gstatic.com. Even when cached (transfer 0) their parse/exec durations dominate (e.g. firebase-app-compat up to 5.7s on Wi-Fi), and on a true cold load they add 3 cross-origin round-trips + large parse.
- Impact: Largest single contributor to launch-to-interactive (25.5s Wi-Fi / 40.5s 4G / 44.0s 3G) and to TBT.

**#4. Launch-to-interactive is 25-44 seconds**
- Evidence: launch_auth_interactive_ms avg: Wi-Fi 25.5s, 4G 38.6s, 3G 42.4s (p90 ~44s). This is the worst user-facing metric by far and dwarfs Lighthouse TTI because it waits for Firebase auth readiness, not just main-thread idle.
- Impact: A new visitor on 4G/3G waits ~40s before the login screen is usable. Critical UX failure.

**#5. 3G payload / network throttling blows every budget**
- Evidence: On 3G: LCP 13.1s (target 8s, FAIL), TTI 14.1s (target 10s, FAIL), Speed Index ~19.7s, perf score 31 (target 50, FAIL).
- Impact: Low-end-network users effectively cannot use the PWA in reasonable time.

**#6. Pi AI debrief endpoint unreachable from test runner**
- Evidence: All 9 API probes returned outcome=error (TypeError), median wait 359-843ms. Matches documented Pi-offline -> offline-template fallback. Not an app perf bug, but the debrief path is unverified from this environment.
- Impact: Debrief latency/quality unmeasured; functional gap to verify on the Tailscale network.

## 7. Prioritized remediation recommendations

### HIGH impact
1. Introduce a build step (Vite) that bundles Vue + app code, splits vendor chunks, and minifies. Removes the no-build full-runtime penalty and enables code-splitting.
2. Lazy-load faa_index.js + faaRag.js only when the AI Feedback / debrief feature is opened (dynamic import). Removes ~53 KB + parse from the cold-landing critical path.
3. Replace the 3 Firebase compat scripts with the ESM modular SDK (firebase/app, auth, firestore), bundled locally or self-hosted, instead of gstatic.com cross-origin. Cuts parse + eliminates 3 cross-origin round-trips.

### MEDIUM impact
1. Self-host or preconnect (rel=preconnect + dns-prefetch) the Firebase/gstatic origin; add <link rel=preload> for the app entry script and critical CSS.
2. Defer non-critical first-paint work: move seed.js / manifest handling off the critical path; ensure the auth screen paints before Firebase auth state resolves (show skeleton, then hydrate).
3. After remediation, re-run Lighthouse and confirm launch-to-interactive drops under ~5s on Wi-Fi and under ~10s on 4G; gate CI on the >20%-vs-baseline regression rule.

### LOW impact
1. Re-test the Pi AI debrief endpoint from a machine on the Tailscale network; add a graceful, bounded timeout UI so Pi-offline fallback is a fast, visible state rather than a 0.3-0.8s hang.
2. Add field monitoring (Firebase Performance Monitoring SDK) for real-user launch time, API latency, and screen transitions; the lab Lighthouse numbers understate cold-cache reality.
3. Cover the two blocked scenarios: authenticated-dashboard Lighthouse (needs a Firebase test account) and the Android app (needs a device/emulator or Firebase Perf).

## 8. Gaps & follow-up

- Provide a Firebase test account so the authenticated-dashboard path can be Lighthouse-tested (currently only cold landing is measured).
- Provision an Android device/emulator (or Firebase Performance Monitoring SDK) to cover the native app surface.
- Re-test the Pi debrief endpoint from a Tailscale-connected machine and confirm debrief latency/quality.
- After the HIGH-impact fixes land, re-run the full matrix and re-baseline; wire the >20%-vs-baseline rule into CI as a regression gate.

## 9. Data inventory & reproducibility

- Raw runs analyzed: 36 (Lighthouse CWV 18, launch 9, API 9) + 9 baseline reference runs.
- Baseline source: `t_21c6a2b7/BASELINE.json` (approved).
- Load-time: `t_e1b76371/LOAD-COMBINED.json`. Speed CWV: `t_8e5ad8e5/cwv-results-COMBINED.json`. Launch/transition + API: `D:\grading-portal-web\perf-tests\reports\`.
- This report + `PERF-ANALYSIS.json` + `PERF-STATS.csv` generated by `analyze.py` (deterministic; re-run reproduces all numbers).
