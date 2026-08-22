# Mobile Speed & Responsiveness Test Results — t_8e5ad8e5

**Target app:** Student Grading Portal PWA — `https://ramihoujeiry.github.io/student-grading-portal-web/`
**Device emulation:** Moto G Power (360×640, DPR 3, 4× CPU throttle, Chrome 151, Lighthouse 13.4.1)
**Networks:** Wi-Fi (native), 4G (Lighthouse Slow-4G preset), 3G (custom 400 Kbps / 400 ms)
**Methodology:** Every test run **3×**; **median** recorded. Each test class × 3 networks × 3 runs =
**27 raw test cases**, all completed (no missing cases).
**Raw data + reports also copied to shared project drive:** `D:\grading-portal-web\perf-tests\`

## Test classes

| Class | What it measures | Tool | Raw files |
|---|---|---|---|
| **Core Web Vitals (CWV)** | LCP, FCP, TBT, Speed Index, CLS, TTI, max-potential-FID, perf score | Lighthouse 13.4.1 | `cwv-<net>-*.json` (9) |
| **App launch time** | Time to interactive auth screen (email input usable) | Puppeteer + CDP | `launch-<net>-*.json` (9) |
| **Screen transition latency** | Sign-in → Register toggle render | Puppeteer + CDP | (same `launch-*.json` files) |
| **Core API response times** | Firebase assets, Pi AI debrief endpoint | Puppeteer + CDP Resource Timing | `api-<net>-*.json` (9) |

## Median results (the headline)

| Network | Perf | FCP | LCP | TTI | CLS | Launch→auth | Transition | Pi debrief | Firebase |
|---|---|---|---|---|---|---|---|---|---|
| Wi-Fi | 56 | 1479 ms | 5927 ms | 6981 ms | 0.00 | 25 530 ms | 858 ms | error (359 ms) | 2263 ms |
| 4G | 42 | 1185 ms | 5492 ms | 6417 ms | 0.00 | 40 563 ms | 808 ms | error (843 ms) | 965 ms |
| 3G | 31 | 2777 ms | 13 077 ms | 13 877 ms | 0.00 | 44 018 ms | 892 ms | error (429 ms) | 1445 ms |

(Full per-metric table in `SPEED-RESPONSIVENESS-COMBINED.csv` / `.json`.)

## Consolidated deliverables

- `reports/SPEED-RESPONSIVENESS-COMBINED.json` — unified per-network metric table (CWV + launch + API)
- `reports/SPEED-RESPONSIVENESS-COMBINED.csv` — same, spreadsheet-friendly
- `reports/cwv-results-COMBINED.json` — Lighthouse CWV aggregates (3 networks)
- `reports/launch-transition-*.json` — launch/transition aggregates
- `reports/api-response-*.json` — API timing aggregates
- `raw-data/cwv-*.json`, `raw-data/launch-*.json`, `raw-data/api-*.json` — 27 self-describing raw runs
- Shared drive mirror: `D:\grading-portal-web\perf-tests\raw-data\` + `…\reports\`

## Known gaps / caveats (consistent with PERFORMANCE_TEST_PLAN.md §7)

- **Pi AI debrief endpoint unreachable from this runner** (all 9 API runs returned `error`,
  median wait 359–843 ms). This matches the documented "Pi offline → app falls back to offline
  template" behaviour — so the debrief *wait* is the error/timeout duration, not a perf regression
  in the app itself. The endpoint should be re-tested from a machine on the Tailscale network.
- **No Android-app tests** — no device/emulator/adb on this runner (plan §7).
- **No authenticated-dashboard Lighthouse runs** — no test account (plan §7).
- **iOS/WebKit** not measured — Chrome Lighthouse cannot emulate Safari.
- 2 orphaned Lighthouse files from an aborted earlier run were moved aside to
  `raw-data/_superseded/` and superseded by this clean 3×3 matrix.

## Repro

```
tools/cwv-runner.js       # Lighthouse CWV 3x3 (kills Chrome at valid-JSON, retries crashed runs)
scripts/launch-transition.js --network=all --runs=3
scripts/api-times.js         --network=all --runs=3
```
