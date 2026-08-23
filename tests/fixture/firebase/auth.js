// Stub for 'firebase/auth' — symbols imported by store.js.
// Not exercised in the no-Firebase fixture (FIREBASE_READY false).
export function getAuth() { return {}; }
export function signInWithEmailAndPassword() { return Promise.resolve({ user: {} }); }
export function createUserWithEmailAndPassword() { return Promise.resolve({ user: {} }); }
export function signOut() { return Promise.resolve(); }
export function onAuthStateChanged() { return () => {}; }
export function sendEmailVerification() { return Promise.resolve(); }
