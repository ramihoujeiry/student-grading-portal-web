/* =========================================================================
 * firebase-config.js — Firebase web app configuration (ESM).
 *
 * projectId / appId / storageBucket are taken from your Android
 * google-services.json (project "grading-portal-app").
 *
 * The apiKey is PUBLIC client-side data (it ships inside the Android app too).
 * Paste your real web apiKey here. Get it from:
 *   Firebase console -> Project settings -> Your apps -> Web app -> apiKey
 * (or copy the "current_key" from your real google-services.json — the copy on
 *  this machine has it masked as AIzaSy...8Xbk). The app will not connect to
 *  Firebase until this is the real 39-char key starting with AIzaSy.
 * ========================================================================= */

export const FIREBASE_CONFIG = {
  apiKey: "***",
  authDomain: "grading-portal-app.firebaseapp.com",
  projectId: "grading-portal-app",
  storageBucket: "grading-portal-app.firebasestorage.app",
  messagingSenderId: "131936808081",
  appId: "1:131936808081:android:60eb1c1d4b81a20153e330"
};

// True once a real key is in place.
export const FIREBASE_READY = typeof FIREBASE_CONFIG.apiKey === 'string'
  && FIREBASE_CONFIG.apiKey.startsWith('AIzaSy')
  && !FIREBASE_CONFIG.apiKey.includes('PASTE');
