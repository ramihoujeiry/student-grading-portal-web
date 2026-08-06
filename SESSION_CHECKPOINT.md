# Session Checkpoint — Student Grading Portal (web PWA)

Saved: 2026-08-06 (session continued across compaction + out-of-band messages)
Branch: `main` @ `58ab0c2`
Deploy: https://ramihoujeiry.github.io/student-grading-portal-web/
SW cache: `grading-portal-v12`

## Original app (source of truth)
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
