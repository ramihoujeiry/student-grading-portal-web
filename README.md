# Student Grading Portal — Web App

Web edition of the Android **Student Grading Portal** flight-training grading app,
built as an offline-capable, installable PWA that uses the **same Firebase backend**
(project `grading-portal-app`) as the Android app.

## Live site
https://ramihoujeiry.github.io/student-grading-portal-web/

## What it does
- Email/password sign-in (Firebase Auth). New accounts start as **pending** and an
  admin grants a role (admin / instructor / viewer) from the Firebase console.
- Students, instructors, aircraft, MIF tables (per aircraft + phase, per-stage
  required MIF + weights).
- Flight evaluations: grade each maneuver 1–4; final grade and MEETS/BELOW STANDARD
  status are computed identically to the Android app.
- Announcements (all / instructor / viewer).
- Offline, deterministic AI performance feedback (trend, consistency, weak
  maneuvers, readiness verdict, instructor next-trip plan).
- Real-time Firestore listeners keep the UI in sync across devices.

## One setup step — Firebase web apiKey
The web app reads its Firebase config from `firebase-config.js`. The `apiKey`
field currently holds a `PASTE_...` placeholder. Firebase will NOT connect until you
drop in the real web apiKey (it is public client-side data — the same key ships
inside the Android app):

1. Firebase console → **Project settings** → **Your apps** → Web app → copy the `apiKey`.
   (Or copy `current_key` from your real `google-services.json`.)
2. Paste it into `firebase-config.js` as `apiKey: "AIzaSy...."`.
   The key is a 39-character string that **must start with `AIzaSy`**
   (e.g. `AIzaSy...`); the app will not connect until a real `AIzaSy...` key
   replaces the `PASTE_...` placeholder. Do not leave the `PASTE_` placeholder
   or the masked `«reda...»` value in place.
3. Deploy: `git add firebase-config.js && git commit -m "config" && git push`.

Also make sure:
- **Authentication → Sign-in method → Email/Password** is enabled in Firebase.
- **Firestore** is created and `firestore.rules` (in this repo) is published:
  `firebase deploy --only firestore:rules` (or paste it into the Firestore Rules tab).
- The Android app's existing data in `students / instructors / aircraft / mif_tables /
  evaluations / announcements / users` is reused automatically (same project, same
  collection names).

## Local development
Serve the folder over HTTP (service workers need a secure context / localhost):
```
python -m http.server 8123
# open http://localhost:8123/
```

## Files
- `src/` — the app (Vite project root): `src/index.html` (shell + tabs + auth screen),
  `src/app.js` (Vue 3 SPA logic), `src/store.js` (Firebase data layer + grading/AI math
  ported from the Android app), `src/seed.js` (sample data for first admin sign-in),
  `src/firebase-config.js` (paste your apiKey here), `src/main.js` (entry).
- `src/public/` — PWA assets served as-is: `sw.js` (offline service worker),
  `manifest.webmanifest`, `icons/`.
- `firestore.rules` — security rules (role-based)
- Root `index.html` / `assets/` — the built site deployed to GitHub Pages (see "Deploy" below)

## Deploy
`npm run build` emits to `dist/`; copy its contents to the repo root (or configure Pages to
serve `dist/`) so GitHub Pages serves the bundled app at `/student-grading-portal-web/`.

## AI feedback (Pi proxy)
The AI debrief calls the Pi's OpenAI-compatible proxy through Tailscale Funnel
(`LAN_AI_ENDPOINT` in `src/store.js`). No secret is required — the proxy is reachable
because Tailscale Funnel makes it public, and the app sends plain JSON requests.
