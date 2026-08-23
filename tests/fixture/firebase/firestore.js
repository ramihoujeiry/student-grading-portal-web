// Stub for 'firebase/firestore' — symbols imported by store.js.
// Not exercised in the no-Firebase fixture (FIREBASE_READY false).
export function getFirestore() { return {}; }
export function collection() { return {}; }
export function doc() { return {}; }
export function getDoc() { return Promise.resolve({ exists: () => false, data: () => ({}) }); }
export function getDocs() { return Promise.resolve({ empty: true, docs: [] }); }
export function setDoc() { return Promise.resolve(); }
export function addDoc() { return Promise.resolve({ id: 'stub' }); }
export function updateDoc() { return Promise.resolve(); }
export function deleteDoc() { return Promise.resolve(); }
export function onSnapshot() { return () => {}; }
export function query() { return {}; }
export function orderBy() { return {}; }
export function limit() { return {}; }
export function where() { return {}; }
export function writeBatch() {
  return { set() {}, commit() { return Promise.resolve(); } };
}
export function serverTimestamp() { return {}; }
