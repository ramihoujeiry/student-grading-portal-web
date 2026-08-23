# Session Checkpoint — Student Grading Portal (web PWA)

Saved: 2026-08-06 (session continued across compaction + out-of-band messages)
Branch: `main` @ `455abc2`
Deploy: https://ramihoujeiry.github.io/student-grading-portal-web/
SW cache: `grading-portal-v22`

## AI feedback — REAL online model, COMPLETELY FREE via Pi/Hermes (commit 455abc2)
- `runAIForStudent` (app.js) async -> `getAIConfig()` (store.js) returns a LAN default (Firestore `config/ai` override supported but rules not deployed).
- LAN default: endpoint `https://192.168.1.200:8787/v1/chat/completions`, model `tencent/hy3:free`.
- The Pi (`pi@192.168.1.200`) runs `/home/pi/.hermes/ai_proxy.py` (HTTPS, self-signed cert, CORS). It shells out to `hermes chat -q ... -m tencent/hy3:free -Q --provider nous` — uses Hermes' OWN Nous Portal auth, so it is COMPLETELY FREE (no OpenRouter key needed; OpenRouter `:free` is blocked on this key anyway).
- Why HTTPS: GitHub Pages is HTTPS; browser blocks mixed-content HTTP fetch -> proxy must be HTTPS. Self-signed cert at `/home/pi/.hermes/ai_proxy.crt`/`.key`. USER MUST trust cert once (open `https://192.168.1.200:8787/` in browser, accept warning; or `certutil -addstore ROOT ai_proxy.crt` as admin) so `fetch()` succeeds.
- `callAIModel` tolerant of reasoning models (uses `content`, falls back to `reasoning`).
- Verified: python from this machine reached `https://192.168.1.200:8787` and got real `tencent/hy3:free` reply (HY3_OK). App correctly falls back to template if proxy unreachable (no page errors).
- NOTE: Playwright/Chromium in THIS sandbox could not reach the Pi LAN IP (net::ERR_FAILED) — environment limitation, not a code defect. On the user's real device (same WiFi) the browser reaches it.
- firestore.rules `config/{doc}` admin-write rule added but NOT deployed (no firebase token). Optional cloud override path.
- Pi proxy is a `nohup` process (pid ~31507), NOT a systemd service -> dies on Pi reboot. Add systemd unit if persistence wanted.

`D:\perfect - Copy` — Android Kotlin Student Grading Portal, Firebase/Firestore.
Role enum (Constants.kt): `ROLE_ADMIN="admin"`, `ROLE_INSTRUCTOR="instructor"`, `ROLE_VIEWER="viewer"`, `ROLE_PENDING="pending"`.
Native nav groups:
- `group_general` (all signed-in): Announcements, Grading, Trip History, Analytics, Student Hours, Dashboard(global), Failures.
- `group_admin_tools` (admin only, `menu.setGroupVisible(R.id.group_admin_tools, isAdmin)`): Broadcast, User Management, Manage Students, Manage Instructors, Manage MIF.
- Viewer: `nav_grading` hidden + MainActivity redirects viewers to Announcements (cannot grade).
- Native `updateSummary`: N/A grades stored as `null`; failCount counts `studentGrade != null && studentGrade < mif`. So N/A is NEVER counted as below-MIF.

## Web parity achieved (this session + prior)
- No-build Vue 3 (vendored `vue.global.prod.js` WITH compiler), Firebase compat CDN, installable PWA (manifest + sw.js).
- Collections mirror Android: students, instructors, aircraft, mif_tables, evaluations, users, announcements.
- Grading math: grade 1→65, 2→75, 3→85, 4→95; final = weighted avg by stage factor; MIF status = BELOW STANDARD if ≥2 maneuvers scored below required MIF, else MEETS STANDARD.
- Auth: email/password; `onUser` mirrors Android LoginViewModel — signs out if `!emailVerified` OR `role==pending` with native message.
- Tabs: Dashboard, Students, Instructors, Aircraft, MIF Tables, Evaluations, Announcements, Analytics, Training Progress, Users(admin), AI Feedback.

## Changes made THIS session (commits a9c64eb → 58ab0c2)
1. a9c64eb — N/A no longer counted as below-MIF.
   - `calcMifStatus` (store.js): added `&& m.studentGrade !== 0` (web uses 0 for N/A; Android uses null).
   - `evalPreview` (app.js): same `&& m.studentGrade !== 0` in failCount.
   - Instructor restrictions: Students/Instructors/Aircraft/MIF/Users tabs `v-if="isAdmin"`; announcements `+ Post` & delete `v-if="isAdmin"`; eval delete (list + detail) `v-if="isAdmin"`.
2. cb70224 — Apply original role model.
   - Evaluations tab `v-if="!isViewer"` (viewers cannot grade, matching native).
   - New Evaluation student/instructor dropdowns use `activeStudents`/`activeInstructors` computeds (exclude `active===false`) — inactive students/instructors no longer appear.
   - `openNewEval` defaults to first ACTIVE student/instructor.
3. 58ab0c2 — Instructor perm fix (out-of-band).
   - Student profile modal (opened from Analytics/Training Progress) Deactivate/Activate button: `canEdit` → `isAdmin`. Instructors could previously toggle student active state from there — now admin-only.
   - All management-tab actions hardened to `isAdmin`: addStudent, addInstructor, addAircraft, addMifTable, addManeuver, deleteStudent, deleteInstructor, deleteAircraft, deleteMifTable, deleteManeuver.
   - Only remaining `canEdit` is `openNewEval` (+ New Evaluation) — instructors must keep grading ability.

## Final role matrix (web == native)
- Admin: everything + management + announcement post/delete + eval delete/edit + user approval.
- Instructor: Dashboard, Evaluations (grade), Announcements (view-only), Analytics, Training Progress, AI Feedback. NO management tabs, NO eval deletion, NO student/instructor toggle.
- Viewer: read-only; no Evaluations (grading) tab.
- Pending: blocked at login.

## Verified live (Playwright headless, SW blocked, real Firebase + GitHub Pages)
- N/A fix: set maneuvers N/A → `na_counted_as_fail: False`, preview "0 maneuver(s) below required MIF".
- Active filter (reversible toggle): baseline dropdown 9 → deactivate one student → 8 → reactivate → 9. Proves inactive exclusion. Zero page errors.
- Role fix deployed: fetched served `index.html` — `v-if="isAdmin"` present on profile toggle, mgmt deactivate/delete, instructor toggle, addStudent; `openNewEval` stays `v-if="canEdit"`. Live admin still sees all buttons.
- NOTE: `search_files` tool FAILS on `D:/grading-portal-web/index.html` (MSYS path error os 3) — use `read_file`/`patch`/`grep` in terminal instead.

## Files of interest
- `D:\grading-portal-web\app.js` — Vue component: data, computeds (`activeStudents`,`activeInstructors`,`evalPreview`,`currentTable`), methods (`openNewEval`,`toggleStudentActive`, etc.), `isAdmin`/`isViewer`/`canEdit` flags.
- `D:\grading-portal-web\store.js` — `calcFinalGrade`, `calcMifStatus`, Firestore CRUD, AI feedback.
- `D:\grading-portal-web\index.html` — all templates + role gating (`v-if`).
- `D:\grading-portal-web\firestore.rules` — `isStaff()` (admin/instructor) can write `users` (for role mgmt); `isSignedIn()` reads; eval writes by staff.
- `D:\grading-portal-web\sw.js` — CACHE `grading-portal-v12`.

## Credentials (REDACTED — never commit)
- Firebase apiKey / GitHub token / user password stored outside repo. Git remote uses token via `awk 'NR==2' /tmp/cred.txt`.

## Open follow-ups (not requested this session)
- Detail-eval modal still shows a "Weight" column (read-only). Native manages weights in MIF Tables; user only asked to drop weight from NEW-evaluation input. Left as-is.
- No automated test suite committed — verification was ad-hoc Playwright, scripts deleted after each run.
- Consider saving the Playwright verification approach as a reusable skill (web PWA live-parity checks against Firebase).

## Tailscale Funnel migration (2026-08-08) — REPLACED Cloudflare tunnel
- **Old stack retired:** Cloudflare quick tunnel (`ai-tunnel.service`) + `pi_rewire.sh`/`pi_rewire.timer` (rewrote `store.js` LAN_AI_ENDPOINT every 2 min) + system `cloudflared.service` (named tunnel `grading-ai`, no domain). All disabled; no more URL churn, no GitHub token in plaintext on Pi.
- **New stack:** Tailscale Funnel. Pi `ai-proxy.service` (unchanged) serves `127.0.0.1:8788` → shells out to Hermes/Nous `tencent/hy3:free` (free, no API key in client). `tailscale funnel 8788` exposes public `https://raspberrypi.tail3a08db.ts.net` (tailnet `ramihoujeiry`). URL is **stable across Pi reboots** (the whole point of the switch).
- **Web:** `store.js` `LAN_AI_ENDPOINT` → `https://raspberrypi.tail3a08db.ts.net/v1/chat/completions`; SW cache bumped to `grading-portal-v42`; committed `d57921b`, pushed, **Pages verified serving new URL**.
- **Android:** `Constants.kt` `AI_LAN_ENDPOINT` → same URL; rebuilt `app-debug.apk` (`D:\perfect - Copy\app\build\outputs\apk\debug\app-debug.apk`), installed manually by user (wireless ADB pairing faulted on MIUI; fell back to manual install).
- **Verified live from open internet:** `/healthz` → 200 `{"ok":true}`; real `tencent/hy3:free` chat reply returned via the Funnel.
- **Caveat:** AI feedback depends on Pi powered + online. If AI ever silently drops to template text, the Pi is off / Funnel stopped (`sudo tailscale funnel list` on Pi to confirm).
- **Re-auth note:** `tailscale up` was run once (user authenticated via `login.tailscale.com` link). If the Pi is ever removed from the tailnet, re-run `sudo tailscale up` and re-approve. Tailnet machine-key expiry set to **Never** (user disabled in admin console 2026-08-08) so devices never silently drop.

## Ask-Data tab (2026-08-08)
- New "Ask Data" tab in web PWA: natural-language Q&A over the grading data, powered by the same free Funnel AI (no Firebase Admin key — uses `this.evaluations/students/mifTables` already loaded for the logged-in user).
- `app.js`: `askData()` builds a compact `buildDataSnapshot()` (counts, per-student eval counts, recent 25 evals, MIF phases) → `callAIModelWithPrompt({system,user}, cfg)` via `getAIConfig()`. Tab markup in `index.html`; SW cache `grading-portal-v43`. Committed `6c3a...` (6c3ea41). Verified `node --check app.js` passes; Funnel health + chat confirmed live.
- Caveat: answers reflect only data the signed-in user can read (Firestore rules still apply). Falls back to an error message if the Pi/Funnel is offline.

## live-parity verification — store.js new feature surface (2026-08-23)

**Context:** auto-triage flagged ~565 added lines of new store.js feature surface (Auth + Firestore
CRUD, realtime listeners, grading math, AI feedback + RAG grounding) with no committed verification
artifact. t_6cc84b1f audited `src/store.js` (689 lines — the live Vite source; legacy root `store.js`
is NOT deployed) and scoped 5 critical paths. This entry records what was actually validated vs not.

**Environment at verification time**
- Repo: `/d/grading-portal-web` (`main` @ `671791d`, ahead of `origin/main` by 1, uncommitted: `src/index.html` CSP tweak + untracked `test/`).
- Firebase project `grading-portal-app`; real `src/firebase-config.js` present (`FIREBASE_READY=true` on a live client).
- RAG assets present: `src/faa-rag/faaRag.js` + `faa_index.js` (lazy-loaded). Build `dist/` present (Vite).
- AI endpoint: Pi Tailscale Funnel `https://raspberrypi.tail3a08db.ts.net/v1/chat/completions` (model `tencent/hy3:free`); cloud `config/ai` override supported.

**Path 3 — Timestamp normalization (year-3995 guard) — VERIFIED, unit-level**
- Fix committed: `671791d` "fix(store): harden Timestamp normalization (year-3995 guard)".
- Re-ran its standalone audit test `scripts/_ts_audit_test.mjs` just now: **16 passed, 0 failed**.
- Covers: numbers (s/ms), Firestore Timestamps (`{seconds}`/`toDate`/`toMillis`), raw JS `Date` objects, ISO strings; invalid/out-of-range (NaN/null/undefined, years <1970 or >2099) collapse to 0 / '-'. The prior bug (a raw `Date` passed where epoch-secs was expected yielding "year 3995") is covered and now passes.
- `node --check src/store.js` → parses clean.
- Scope limitation: the test mirrors the function logic; it does not exercise the live Firestore `watch()` snapshot path end-to-end. That path reuses the same `toEpochSec`/norm logic, so risk is low, but it is not a live-backend run.

**Paths 1, 2, 4, 5 — NOT live-validated yet (status as of this entry)**
- The sibling Playwright task (t_095b2d3d) was still running at the time of writing. Its `test/harness.mjs`
  is **untracked and uncommitted**, and it drives the **real bundled Vue app but injects a LOCAL fake
  dataset — it makes NO Firebase / Firestore calls**. It therefore validates UI render/overflow/a11y
  across viewports and roles, NOT the live data-layer parity (Auth self-heal, realtime CRUD, role sync,
  grading math against real docs, RAG-grounded AI debriefs).
- No committed Playwright run report (`report-all.json` / `summary.txt`) exists yet, so I cannot state
  these paths are confirmed in production-like conditions. I am NOT claiming they are — that would be
  fabricated until the live-backend run produces a report and the test is committed.
- What IS in place to enable that run later: `scripts/_ts_audit_test.mjs` (committed, passing) and the
  `test/` harness scaffold (pending commit + a real Firebase-seeded run). Recommend completing t_095b2d3d
  and appending its report before declaring Paths 1/2/4/5 live-verified.

**Bottom line:** Path 3 (the highest-risk app-blanking bug) is verified by a committed, re-runnable
unit test. Paths 1/2/4/5 remain pending real-backend validation and must not be reported as
production-confirmed until t_095b2d3d produces and commits a live run report.
