/* =========================================================================
 * store.js — Firebase-backed data layer for the Student Grading Portal web app.
 *
 * Mirrors the Android app's DataRepository + auth model:
 *   - Firebase Auth (email/password, email verification required to log in)
 *   - role stored at users/{uid}.role  (admin | instructor | viewer | pending)
 *   - collections: students, instructors, aircraft, mif_tables, evaluations,
 *     announcements, users  (same names as the Android app)
 *   - real-time listeners keep the UI in sync
 *   - grading math + AI feedback (ported from the Android app) are preserved
 *
 * PERF REMEDIATION (t_c6ab4fc3): converted from the Firebase *compat* SDK
 * (3 cross-origin gstatic.com scripts) to the ESM *modular* SDK, bundled
 * locally by Vite. The RAG index is no longer loaded eagerly — it is imported
 * via dynamic import() only when AI Feedback / debrief runs (see getRag()).
 *
 * Exported symbols (consumed by app.js / main.js):
 *   FIREBASE_CONFIG, FIREBASE_READY, Auth, Store, COL,
 *   STATUS_MEETS_STANDARD, STATUS_BELOW_STANDARD, STATUS_PENDING, GRADE_SCORE,
 *   LAN_AI_ENABLED, LAN_AI_ENDPOINT, LAN_AI_MODEL,
 *   getAIConfig, callAIModel, callAIModelWithPrompt,
 *   buildPerformance, buildAIPrompt,
 *   buildSingleEvalData, buildSingleEvalPrompt,
 *   getRag (lazy-loads the FAA RAG layer), getRagIndex (raw index, lazy)
 * ========================================================================= */

import { initializeApp } from 'firebase/app';
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, onAuthStateChanged, sendEmailVerification
} from 'firebase/auth';
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc,
  deleteDoc, onSnapshot, query, orderBy, limit, where, writeBatch, serverTimestamp
} from 'firebase/firestore';
import { FIREBASE_CONFIG, FIREBASE_READY } from './firebase-config.js';
import { SEED } from './seed.js';

/* ---------- Firebase bootstrap (gated on a real config) ------------------ */
let auth = null, dbFs = null, fbReady = false;
if (FIREBASE_READY) {
  const app = initializeApp(FIREBASE_CONFIG);
  auth = getAuth(app);
  dbFs = getFirestore(app);
  fbReady = true;
}

/* ---------- constants (mirror Android Constants.kt) --------------------- */
export const STATUS_MEETS_STANDARD = 'MEETS STANDARD';
export const STATUS_BELOW_STANDARD = 'BELOW STANDARD';
export const STATUS_PENDING = 'PENDING';
export const GRADE_SCORE = { 0: 0, 1: 65, 2: 75, 3: 85, 4: 95 };

export const COL = {
  users: 'users', students: 'students', instructors: 'instructors',
  aircraft: 'aircraft', mifTables: 'mif_tables', evaluations: 'evaluations',
  announcements: 'announcements', broadcasts: 'broadcasts'
};

/* ---------- Timestamp -> epoch seconds normalization -------------------- */
/* Single source of truth for coercing ANY date-like value into epoch SECONDS
   (the unit the rest of the app expects: fmtDate multiplies by 1000, sorting
   subtracts `date` fields, sqrt/avg use finalGrade which is separate).

   Handles every shape a Firestore-backed doc can surface a date as:
     - number            -> already epoch seconds (or ms if >= 1e11)
     - Firestore Timestamp ({seconds, nanoseconds}) -> .seconds
     - Timestamp-like    (.toDate / .toMillis)        -> converted
     - JS Date object    -> getTime()/1000
     - ISO / parseable string                          -> Date.parse/1000
   Anything invalid (NaN, null, out-of-range) collapses to 0 so callers can
   never emit an impossible year (the prior "year 3995" app-blanking bug came
   from passing a raw Timestamp/Date through fmtDate, which did `Date * 1000`). */
const EPOCH_FLOOR = 0;          // 1970-01-01
const EPOCH_CEIL = 4102444800;  // ~2100-01-01 (generous upper bound)
function toEpochSec(v) {
  if (v == null) return 0;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return 0;
    const s = v >= 1e11 ? Math.floor(v / 1000) : v;  // ms-scale -> seconds
    return (s >= EPOCH_FLOOR && s <= EPOCH_CEIL) ? s : 0;
  }
  if (typeof v === 'object') {
    if (typeof v.seconds === 'number') return v.seconds;
    if (typeof v.toMillis === 'function') return Math.floor(v.toMillis() / 1000);
    if (typeof v.toDate === 'function') {
      const d = v.toDate();
      return (d instanceof Date && !isNaN(d.getTime())) ? Math.floor(d.getTime() / 1000) : 0;
    }
    if (v instanceof Date) return isNaN(v.getTime()) ? 0 : Math.floor(v.getTime() / 1000);
  }
  if (typeof v === 'string') {
    const ms = Date.parse(v);
    if (!isNaN(ms)) return Math.floor(ms / 1000);
  }
  return 0;
}

/* ---------- AI backend (LAN default = Hermes gateway proxy on the Pi) ------ */
/* The Pi (pi@192.168.1.200) runs ai_proxy.py exposing an OpenAI-compatible
   /v1/chat/completions endpoint that forwards to OpenRouter using the key
   stored in /home/pi/.hermes/.env (key never reaches the browser). Used when
   no Firestore config/ai doc is set. For cloud use, set config/ai (admin-
   only write) and this LAN default is ignored. */
export const LAN_AI_ENABLED = true;
export const LAN_AI_ENDPOINT = 'https://raspberrypi.tail3a08db.ts.net/v1/chat/completions';
export const LAN_AI_MODEL = 'tencent/hy3:free';

/* ---------- lazy RAG access ---------------------------------------------- */
/* The FAA / UH-1 / Robinson FTG index is big (~220KB) and only needed when a
   debrief actually runs. We load it on demand through dynamic import() so it
   is never on the cold landing path. */
let _ragPromise = null;
async function getRag() {
  if (!_ragPromise) {
    _ragPromise = import('./faa-rag/faaRag.js').then(m => m.FaaRag);
  }
  return _ragPromise;
}
export { getRag };

/* ---------- auth service ------------------------------------------------- */
export const Auth = {
  ready: fbReady,
  onUser(cb) { if (!fbReady) return () => {}; return onAuthStateChanged(auth, cb); },

  async login(email, password) {
    const u = await signInWithEmailAndPassword(auth, email, password);
    if (u.user && !u.user.emailVerified) {
      await signOut(auth);
      throw new Error('Please verify your email before logging in. Check your inbox.');
    }
    return u;
  },
  async register(email, password, fullName) {
    const u = await createUserWithEmailAndPassword(auth, email, password);
    if (u.user) {
      await sendEmailVerification(u.user);
      await setDoc(doc(dbFs, COL.users, u.user.uid), {
        uid: u.user.uid, name: fullName, email: email, role: 'pending'
      });
    }
    return u;
  },
  // Self-heal: if a signed-in user has no users/{uid} doc (e.g. they registered
  // while Firestore rules were still locked, or the doc was deleted), create a
  // pending one so they appear in the admin tab and the app doesn't dead-end.
  async upsertUserDoc(u) {
    if (!fbReady || !u) return;
    const ref = doc(dbFs, COL.users, u.uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        uid: u.uid,
        name: u.displayName || (u.email ? u.email.split('@')[0] : 'Unknown'),
        email: u.email || '',
        role: 'pending'
      });
    }
  },
  async logout() { if (fbReady) await signOut(auth); },
  async roleOf(uid) {
    if (!fbReady || !uid) return 'pending';
    const d = await getDoc(doc(dbFs, COL.users, uid));
    return (d.exists() && d.data().role) || 'pending';
  }
};

/* Exposed for app.js (which needs the current Firebase user synchronously in
   mounted()). The modular SDK keeps `auth` instance module-private, so we hand
   back the current user via a getter. */
export function getCurrentUser() {
  return auth ? auth.currentUser : null;
}

/* ---------- data service (CRUD + listeners) ----------------------------- */
export const Store = {
  ready: fbReady,
  _unsubs: [],

  // generic realtime collection -> callback(list)
  watch(collectionName, cb, opts = {}) {
    if (!fbReady) { cb([]); return () => {}; }
    let q = query(collection(dbFs, collectionName));
    if (opts.orderBy) q = query(q, orderBy(opts.orderBy, opts.dir || 'asc'));
    // Firestore may store date-like fields as Timestamp objects (or, in legacy
    // data, raw JS Date objects). Normalize every known date field to plain
    // epoch SECONDS via toEpochSec() so the rest of the app (fmtDate multiplies
    // by 1000, sorting/subtraction use the value directly) stays safe. Invalid
    // values collapse to 0 — never an impossible year.
    const TS_FIELDS = ['date', 'createdAt', 'updatedAt', 'timestamp', 'dateSec', 'lastFlightDate'];
    const norm = (o) => {
      if (o == null || typeof o !== 'object') return o;
      const out = { ...o };
      for (const f of TS_FIELDS) {
        if (out[f] != null) out[f] = toEpochSec(out[f]);
      }
      return out;
    };
    const unsub = onSnapshot(q, snap => {
      let list = snap.docs.map(d => ({ ...norm(d.data()), id: d.id }));
      if (opts.activeOnly) list = list.filter(x => x.active);
      cb(list);
    }, err => { console.error('watch', collectionName, err); cb([]); });
    this._unsubs.push(unsub);
    return unsub;
  },

  // Flight-year helper (mirrors Android YearUtils): flight year starts July 1.
  // Jul 2025 -> Jun 2026 = "2025-2026". Used to tag newly added students with the
  // correct year so they appear in the active year, not a stale default.
  currentFlightYear() {
    const d = new Date();
    const y = d.getFullYear();
    const start = d.getMonth() >= 6 ? y : y - 1;
    return start + '-' + (start + 1);
  },

  // students
  async addStudent(name) {
    // Mirror Android YearUtils.getNewStudentActiveYears(): tag with current AND next
    // flight year so the student appears in the Android app's year filter for both
    // years (web used to tag only the current year, so students added here vanished
    // from the Android list once the year advanced).
    const currentYear = this.currentFlightYear();
    const nextYear = currentYear.split('-')[1] + '-' + (parseInt(currentYear.split('-')[1], 10) + 1);
    await addDoc(collection(dbFs, COL.students), { name, active: true, activeYears: [currentYear, nextYear], createdAt: Date.now() / 1000 });
  },
  async setStudentActive(id, active) { await updateDoc(doc(dbFs, COL.students, id), { active }); },
  async deleteStudent(id) { await deleteDoc(doc(dbFs, COL.students, id)); },

  // instructors
  async addInstructor(name) { await addDoc(collection(dbFs, COL.instructors), { name, active: true, createdAt: Date.now() / 1000 }); },
  async setInstructorActive(id, active) { await updateDoc(doc(dbFs, COL.instructors, id), { active }); },
  async deleteInstructor(id) { await deleteDoc(doc(dbFs, COL.instructors, id)); },

  // aircraft
  async addAircraft(name) { await addDoc(collection(dbFs, COL.aircraft), { name }); },
  async deleteAircraft(id) { await deleteDoc(doc(dbFs, COL.aircraft, id)); },

  // mif tables (doc id = aircraftType + '_' + phaseName, like Android)
  async addMifTable(aircraftType, phaseName, stages) {
    const id = aircraftType + '_' + phaseName;
    await setDoc(doc(dbFs, COL.mifTables, id), { aircraftType, phaseName, stages, maneuvers: [], updatedAt: Date.now() / 1000 });
  },
  async addManeuver(tableId, maneuver) {
    const ref = doc(dbFs, COL.mifTables, tableId);
    const d = await getDoc(ref);
    const maneuvers = (d.exists() && d.data().maneuvers) || [];
    maneuvers.push(maneuver);
    await updateDoc(ref, { maneuvers });
  },
  async deleteManeuver(tableId, idx) {
    const ref = doc(dbFs, COL.mifTables, tableId);
    const d = await getDoc(ref);
    const maneuvers = (d.exists() && d.data().maneuvers) || [];
    maneuvers.splice(idx, 1);
    await updateDoc(ref, { maneuvers });
  },
  async deleteMifTable(tableId) { await deleteDoc(doc(dbFs, COL.mifTables, tableId)); },

  // evaluations
  async saveEvaluation(ev) {
    if (!ev.id) {
      const ref = await addDoc(collection(dbFs, COL.evaluations), { ...ev, instructorUid: (auth.currentUser && auth.currentUser.uid) || '', createdAt: Date.now() / 1000 });
      ev.id = ref.id;
    } else {
      await setDoc(doc(dbFs, COL.evaluations, ev.id), { ...ev, instructorUid: (auth.currentUser && auth.currentUser.uid) || '' });
    }
    return ev.id;
  },
  async deleteEvaluation(idOrObj) {
    const id = (idOrObj && typeof idOrObj === 'object') ? (idOrObj.id || idOrObj._id) : idOrObj;
    if (!id) throw new Error('Cannot delete evaluation: missing document id');
    await deleteDoc(doc(dbFs, COL.evaluations, id));
  },

  // announcements
  async addAnnouncement(a) { await addDoc(collection(dbFs, COL.announcements), a); },
  async deleteAnnouncement(id) { await deleteDoc(doc(dbFs, COL.announcements, id)); },

  // broadcasts (admin-only messaging)
  async addBroadcast(b) { await addDoc(collection(dbFs, COL.broadcasts), { ...b, createdAt: Date.now() / 1000 }); },
  async deleteBroadcast(id) { await deleteDoc(doc(dbFs, COL.broadcasts, id)); },

  // users (admin only) — mirrors Android UserManagementViewModel
  async approveUser(u, role) {
    await updateDoc(doc(dbFs, COL.users, u.uid), { role, updatedAt: Date.now() / 1000 });
    await this._syncInstructor(u, role);
  },
  async updateUserRole(u, role) {
    await updateDoc(doc(dbFs, COL.users, u.uid), { role, updatedAt: Date.now() / 1000 });
    await this._syncInstructor(u, role);
  },
  // Keep the instructors collection in sync with the user's role, exactly like Android.
  // instructor/admin => ensure instructors/{uid} exists (active). viewer/pending => remove it.
  async _syncInstructor(u, role) {
    const ref = doc(dbFs, COL.instructors, u.uid);
    if (role === 'instructor' || role === 'admin') {
      await setDoc(ref, { id: u.uid, name: u.name || u.email || '', active: true, createdAt: Date.now() / 1000 });
    } else {
      await deleteDoc(ref).catch(() => {});
    }
  },
  async deleteUser(u) {
    // native rejects (removes) the user doc; also drop any instructors/{uid} mirror, matching Android rejectUser
    await deleteDoc(doc(dbFs, COL.users, u.uid));
    await deleteDoc(doc(dbFs, COL.instructors, u.uid)).catch(() => {});
  },

  // first-run seeding (admin only). Mirrors the sample data for an empty project.
  async seedIfEmpty(user) {
    if (!fbReady) return;
    const snap = await getDocs(query(collection(dbFs, COL.students), limit(1)));
    if (!snap.empty) return;
    const batch = writeBatch(dbFs);
    const seed = JSON.parse(JSON.stringify(SEED));
    seed.students.forEach(s => batch.set(doc(dbFs, COL.students, s.id), omitId(s)));
    seed.instructors.forEach(i => batch.set(doc(dbFs, COL.instructors, i.id), omitId(i)));
    seed.aircraft.forEach(a => batch.set(doc(dbFs, COL.aircraft, a.id), omitId(a)));
    seed.mifTables.forEach(t => batch.set(doc(dbFs, COL.mifTables, t.aircraftType + '_' + t.phaseName), omitId(t)));
    seed.evaluations.forEach(e => batch.set(doc(dbFs, COL.evaluations, e.id), omitId(e)));
    seed.announcements.forEach(an => batch.set(doc(dbFs, COL.announcements, an.id), omitId(an)));
    await batch.commit();
  },

  // ---- bulk import (mirror of exportCSV) ----
  // Write many evaluation docs in one batched commit. Each eval carries its own
  // id (set to the existing doc id when the row is a duplicate) so a re-import
  // overwrites rather than duplicates. maneuverGrades may be empty (summary-only
  // import, since the CSV export doesn't include per-maneuver detail).
  async bulkSaveEvaluations(evals) {
    if (!evals || !evals.length) return 0;
    const batch = writeBatch(dbFs);
    evals.forEach(ev => {
      const id = ev.id || doc(collection(dbFs, COL.evaluations)).id;
      batch.set(doc(dbFs, COL.evaluations, id), { ...ev, id });
    });
    await batch.commit();
    return evals.length;
  },

  // Full-dataset restore from a backup JSON (offline disaster recovery).
  // Writes students/instructors/aircraft/mif_tables/evaluations/announcements.
  // Intentionally EXCLUDES `users` (auth-linked accounts) to avoid clobbering
  // roles or importing another project's accounts.
  async importAll(dataset) {
    if (!fbReady || !dataset) return 0;
    const targets = [
      [COL.students, dataset.students],
      [COL.instructors, dataset.instructors],
      [COL.aircraft, dataset.aircraft],
      [COL.mifTables, dataset.mifTables],
      [COL.evaluations, dataset.evaluations],
      [COL.announcements, dataset.announcements]
    ];
    let written = 0;
    for (const [col, docs] of targets) {
      if (!Array.isArray(docs) || !docs.length) continue;
      const batch = writeBatch(dbFs);
      docs.forEach(d => {
        const id = (d && d.id) || doc(collection(dbFs, col)).id;
        batch.set(doc(dbFs, col, id), { ...d, id });
      });
      await batch.commit();
      written += docs.length;
    }
    return written;
  }
};

function omitId(o) { if (!o) return {}; const { id, ...rest } = o; return rest; }

/* ---------- grading math (ported 1:1 from Android) ---------------------- */
export function calcFinalGrade(maneuverGrades) {
  if (!maneuverGrades || maneuverGrades.length === 0) return null;
  const graded = maneuverGrades.filter(m => m && m.studentGrade != null && m.studentGrade !== 0);
  if (graded.length === 0) return null;
  let tw = 0, w = 0;
  for (const m of graded) {
    const score = GRADE_SCORE[m.studentGrade] || 0;
    if (score > 0) { tw += score * m.factor; w += m.factor; }
  }
  if (w === 0) return null;
  return Math.round((tw / w) * 1000) / 1000;
}
export function calcMifStatus(maneuverGrades) {
  const any = (maneuverGrades || []).some(m => m && m.studentGrade != null && m.studentGrade !== 0);
  if (!any) return STATUS_PENDING;
  let fail = 0;
  for (const m of (maneuverGrades || [])) if (m && m.studentGrade != null && m.studentGrade !== 0 && m.requiredMif != null && m.studentGrade < m.requiredMif) fail++;
  return fail >= 2 ? STATUS_BELOW_STANDARD : STATUS_MEETS_STANDARD;
}

/* ---------- AI feedback (ported from AIFeedbackGenerator.kt) ------------- */
const STOP_WORDS = new Set(('the a an and or to of in on for with is are was were been be this that it at as by from ' +
  'he she they you we my your their not no but if so do did has have had will would can could should very more than ' +
  'into out up down about his her its our them then there also after before when while which who what how why').split(' '));

export function fmtDate(sec){
  const s = toEpochSec(sec);
  if (!s) return '-';
  const d = new Date(s*1000);
  if (isNaN(d.getTime())) return '-';
  const y = d.getUTCFullYear();
  if (y < 1970 || y > 2099) return '-';   // reject impossible years (year-3995 guard)
  return d.toISOString().slice(0,10);
}

function avg(a){ if(!a||!a.length) return 0; return a.reduce((s,x)=>s+x,0)/a.length; }
function stddev(a){ if(!a||!a.length) return 0; const m=avg(a);return Math.sqrt(a.map(x=>(x-m)*(x-m)).reduce((s,x)=>s+x,0)/a.length); }
function maxKey(o){ if(!o) return null; let bk=null,bv=-Infinity;Object.keys(o).forEach(k=>{if(o[k]>bv){bv=o[k];bk=k;}});return bk; }
function minKey(o){ if(!o) return null; let bk=null,bv=Infinity;Object.keys(o).forEach(k=>{if(o[k]<bv){bv=o[k];bk=k;}});return bk; }
function computeTrend(sorted){
  // Skip null / non-object elements so a malformed entry in the list can't
  // throw on `.finalGrade` (the c8c9d3a app-blanking class).
  const items=(sorted||[]).filter(e=>e&&typeof e==='object');
  if(items.length<2)return{t:'STABLE',d:0};
  const half=Math.floor(items.length/2);
  const first=avg(items.slice(0,half).map(e=>e.finalGrade));
  const second=avg(items.slice(half).map(e=>e.finalGrade));
  const d=second-first;
  return d>=3?{t:'IMPROVING',d}:d<=-3?{t:'DECLINING',d}:{t:'STABLE',d};
}
function maneuverTrendOf(by){
  // Skip null / non-array pairs so a malformed entry can't throw on `[1]`.
  const items=(by||[]).filter(p=>Array.isArray(p));
  if(items.length<2)return 'FLAT';
  const half=Math.floor(items.length/2);
  const first=avg(items.slice(0,half).map(p=>p[1]));
  const second=avg(items.slice(half).map(p=>p[1]));
  const d=second-first;
  return d>=5?'IMPROVING':d<=-5?'DECLINING':'FLAT';
}
function extractThemes(notes){
  if(!notes||!notes.length) return [];
  const counts={};
  // Skip null / non-string notes so a malformed entry can't throw on toLowerCase().
  notes.filter(n=>n&&typeof n==='string').forEach(n=>n.toLowerCase().split(/[^a-z]+/).forEach(w=>{if(w.length>=4&&!STOP_WORDS.has(w))counts[w]=(counts[w]||0)+1;}));
  return Object.keys(counts).sort((a,b)=>counts[b]-counts[a]).slice(0,5);
}

function buildPerformance(student, evals){
  // Normalize each eval's date field defensively so a raw Firestore Timestamp,
  // JS Date, or malformed value can never reach the sort/display math below.
  const normEvals = (evals || []).filter(e=>e&&typeof e==='object').map(e => ({ ...e, date: toEpochSec(e.date) }));
  const sorted=normEvals.slice().sort((a,b)=>(a.date||0)-(b.date||0));
  const overallScore=sorted.length?avg(sorted.map(e=>e.finalGrade)):0;
  const grades=sorted.map(e=>e.finalGrade);
  const volatility=grades.length>=2?stddev(grades):0;
  const trend=computeTrend(sorted);
  const sums={},weights={},requiredMap={};
  sorted.forEach(ev=>(ev.maneuverGrades||[]).forEach(m=>{ if(!m) return;
    const w=Math.max(m.factor,0.01);
    sums[m.name]=(sums[m.name]||0)+m.studentGrade*w;
    weights[m.name]=(weights[m.name]||0)+w;
    if(m.requiredMif>0)requiredMap[m.name]=m.requiredMif;
  }));
  const practicalScores={};
  Object.keys(sums).forEach(n=>{practicalScores[n]=sums[n]/(weights[n]||1);});
  const series={};
  sorted.forEach(ev=>(ev.maneuverGrades||[]).forEach(m=>{ if(!m) return; (series[m.name]=series[m.name]||[]).push([ev.date||0,m.studentGrade]);}));
  const maneuverTrends={};
  Object.keys(series).forEach(n=>{const by=series[n].slice().sort((a,b)=>a[0]-b[0]);maneuverTrends[n]=by.length<2?'FLAT':maneuverTrendOf(by);});
  const weakManeuvers=Object.keys(practicalScores).map(n=>{
    const req=requiredMap[n]||70;
    return{name:n,avgGrade:practicalScores[n],requiredMif:req,belowRequired:practicalScores[n]<req,trend:maneuverTrends[n]};
  }).filter(w=>w.avgGrade<w.requiredMif).sort((a,b)=>a.avgGrade-b.avgGrade);
  const phaseScores={};
  sorted.forEach(ev=>{if(!phaseScores[ev.phaseName])phaseScores[ev.phaseName]=[];phaseScores[ev.phaseName].push(ev.finalGrade);});
  Object.keys(phaseScores).forEach(p=>{phaseScores[p]=avg(phaseScores[p]);});
  const bestManeuver=maxKey(practicalScores),worstManeuver=minKey(practicalScores);
  const overallMifStatus=(sorted.find(e=>e.overallMifStatus)||{}).overallMifStatus||'';
  const instructorNotes=sorted.map(e=>e.tripNotes).filter(n=>n&&n.trim());
  const noteThemes=extractThemes(instructorNotes);
  let readiness;
  if(sorted.length<2)readiness='INSUFFICIENT_DATA';
  else if(weakManeuvers.length&&trend.t==='DECLINING')readiness='REMEDIAL';
  else if(weakManeuvers.length)readiness='RECOVERING';
  else if(volatility>8)readiness='REMEDIAL';
  else readiness='READY';
  const firstDate=sorted.length?sorted[0].date:0,lastDate=sorted.length?sorted[sorted.length-1].date:0;
  return{studentName:(student&&student.name)||'',overallScore,trend:trend.t,trendDelta:trend.d,volatility,
    practicalScores,weakManeuvers,maneuverTrends,phaseScores,bestManeuver,worstManeuver,overallMifStatus,
    instructorNotes,noteThemes,readiness,tripCount:sorted.length,
    firstDateLabel:fmtDate(firstDate),lastDateLabel:fmtDate(lastDate),
    spanDays:sorted.length?Math.floor((lastDate-firstDate)/86400):0,evaluationCount:sorted.length};
}

/* ---- Single-evaluation AI debrief (per-evaluation, not whole student) ---- */
function buildSingleEvalData(ev){
  ev = ev || {};
  const grades=(ev.maneuverGrades||[]).filter(m=>m).map(m=>({name:m.name,grade:m.studentGrade,req:(m.requiredMif>0?m.requiredMif:0),factor:m.factor}));
  const below=grades.filter(g=>g.req>0 && g.grade<g.req).sort((a,b)=>a.grade-b.grade);
  return {studentName:ev.studentName, aircraft:ev.aircraftType, phase:ev.phaseName, trip:ev.tripNumber,
    date:fmtDate(toEpochSec(ev.date)), instructor:ev.instructorName, duration:ev.duration, finalGrade:ev.finalGrade,
    mifStatus:ev.overallMifStatus, grades, below, notes:ev.tripNotes||''};
}
function buildSingleEvalPrompt(d){
  d = d || {};
  const sys='You are a senior flight instructor (CFI) writing a concise, candid coaching debrief for ONE evaluation (a single training trip). Use the data provided. Be specific and actionable. Do NOT invent grades or maneuvers that are not in the data. Write in plain language a human instructor would say. Use short paragraphs. End with concrete next-trip actions.';
  const L=[];
  L.push('Student: '+(d.studentName||'cadet'));
  L.push('Evaluation: '+d.aircraft+' · '+d.phase+' '+d.trip+' · '+d.date+' · instructor '+d.instructor+' · duration '+d.duration+'h');
  L.push('Final grade: '+(d.finalGrade!=null?d.finalGrade.toFixed(1):'-')+'   MIF status: '+d.mifStatus);
  if((d.grades||[]).length){
    L.push('Maneuver grades (name : student grade : required MIF):');
    (d.grades||[]).forEach(g=>L.push('- '+g.name+' : '+g.grade+' : '+(g.req>0?g.req:'n/a')));
  }
  if(d.notes)L.push('Instructor trip notes: '+d.notes);
  L.push('Write a debrief focused on THIS evaluation: what went well, what to fix, and the single most important next-trip action.');
  let user=L.join('\n');
  // Ground this single-eval debrief in real manual text for the below-standard
  // maneuvers (same RAG layer the AI Feedback tab uses). Async so the passages
  // actually attach before the prompt is sent.
  const weak = (d.below && d.below.length)
    ? d.below.map(w => ({ name: w.name, avgGrade: w.grade, requiredMif: w.req }))
    : (d.grades || []).filter(g => g.req > 0 && g.grade < g.req)
        .map(g => ({ name: g.name, avgGrade: g.grade, requiredMif: g.req }));
  return (async () => {
    try {
      const FaaRag = await getRag();
      if (FaaRag && FaaRag.buildFaaContext) {
        const faa = await FaaRag.buildFaaContext({ weakManeuvers: weak });
        if (faa) user += faa;
      }
    } catch (e) { /* RAG is best-effort */ }
    return { system: sys, user };
  })();
}

/* ---------- Online AI adapter (OpenAI-compatible /chat/completions) ------- */
/* Loaded from Firestore config/ai so no key is committed to the repo.
   Expected doc shape:
     { enabled:true, endpoint:"https://.../v1/chat/completions",
       model:"qwen/qwen3.8-max", apiKey:*** }
   If unset, falls back to the LAN Pi proxy default below. The debrief is
   always generated live by the model — there is no offline template. */
async function getAIConfig() {
  // 1) Cloud config (admin-set, overrides LAN default) — only if Firestore rules allow read
  if (fbReady) {
    try {
      const snap = await getDoc(doc(dbFs, 'config', 'ai'));
      if (snap.exists) {
        const d = snap.data() || {};
        if (d.enabled !== false && d.endpoint) {
          return { endpoint: d.endpoint, model: d.model || 'qwen/qwen3.8-max', apiKey: d.apiKey || '' };
        }
      }
    } catch (e) { /* fall through to LAN default */ }
  }
  // 2) LAN default: Hermes gateway proxy on the Pi (no key in client)
  if (LAN_AI_ENABLED) {
    return { endpoint: LAN_AI_ENDPOINT, model: LAN_AI_MODEL, apiKey: '' };
  }
  return null;
}

/* Build a precise prompt from the computed analytics so the model has
   real signal to work with (not just "write something nice"). If the FAA
   RAG index is present, real handbook passages for the cadet's weak
   maneuvers + risk management are appended so the debrief cites FAA source
   material instead of guessing. */
async function buildAIPrompt(data) {
  data = data || {};
  const sys = 'You are a senior flight instructor (CFI) writing a concise, candid coaching debrief for a student pilot. ' +
    'Use the data provided. Be specific and actionable. Do NOT invent grades or maneuvers that are not in the data. ' +
    'Write in plain language a human instructor would say. Use short paragraphs. End with concrete next-trip actions.';
  const L = [];
  L.push('Student: ' + (data.studentName || 'cadet'));
  if (data.yearScope) L.push('School year in scope: ' + data.yearScope + ' (debrief covers ONLY this school year\'s trips)');
  L.push('Trips evaluated: ' + (data.evaluationCount || 0) + '  (' + (data.firstDateLabel || '-') + ' -> ' + (data.lastDateLabel || '-') + ')');
  L.push('Overall average grade: ' + (data.overallScore != null ? data.overallScore.toFixed(1) : '-'));
  L.push('Trend: ' + (data.trend || '-') + (data.evaluationCount >= 2 ? ' (' + Math.abs(data.trendDelta || 0).toFixed(1) + ' pts ' + ((data.trendDelta || 0) >= 0 ? 'up' : 'down') + ')' : ''));
  L.push('Consistency (std dev): ' + (data.volatility != null ? data.volatility.toFixed(1) : '-'));
  if (data.overallMifStatus) L.push('MIF status: ' + data.overallMifStatus);
  if (data.weakManeuvers && data.weakManeuvers.length) {
    L.push('Weak maneuvers (below required MIF):');
    data.weakManeuvers.slice(0, 5).forEach(w => {
      L.push('  - ' + w.name + ': avg ' + w.avgGrade.toFixed(1) + ' (required ' + w.requiredMif + ') trend=' + w.trend);
    });
  }
  if (data.bestManeuver && (data.practicalScores[data.bestManeuver] || 0) >= 70) L.push('Strength: ' + data.bestManeuver + ' (avg ' + data.practicalScores[data.bestManeuver].toFixed(1) + ')');
  if (data.phaseScores && Object.keys(data.phaseScores).length) {
    L.push('Phase averages: ' + Object.keys(data.phaseScores).sort().map(p => p + '=' + data.phaseScores[p].toFixed(1)).join(', '));
  }
  if (data.noteThemes && data.noteThemes.length) L.push('Recurring coach-note themes: ' + data.noteThemes.join(', '));
  if (data.instructorNotes && data.instructorNotes.length) {
    L.push('Recent instructor notes:');
    data.instructorNotes.slice(-5).forEach(n => L.push('  - ' + n));
  }
  L.push('Readiness: ' + (data.readiness || '-'));
  let user = L.join('\n');
  // Append real FAA source material for the cadet's weak areas + risk mgmt,
  // if the RAG index loaded. Keeps the model anchored to the handbook.
  try {
    const FaaRag = await getRag();
    if (FaaRag && FaaRag.buildFaaContext) {
      const faa = await FaaRag.buildFaaContext(data);
      if (faa) user += faa;
    }
  } catch (e) { console.warn('FAA RAG attach skipped:', e && e.message); }
  // Hard safety net: keep the total user payload small so the Pi proxy's argv
  // limit is never exceeded (HTTP 502 "Argument list too long"). Truncate mid-
  // word at the budget and append a marker.
  const USER_MAX = 4000;
  if (user.length > USER_MAX) user = user.slice(0, USER_MAX) + '\n…[truncated]';
  return { system: sys, user };
}

/* Call an OpenAI-compatible chat-completions endpoint. Returns model text. Throws on failure. */
async function callAIModel(data, cfg) {
  if (!cfg || !cfg.endpoint) throw new Error('no AI endpoint');
  const prompt = await buildAIPrompt(data);
  return _postAIModel(prompt, cfg);
}

/* Same as callAIModel but accepts a ready-made {system,user} prompt
   (used by the single-evaluation debrief which has its own prompt builder). */
async function callAIModelWithPrompt(prompt, cfg) {
  if (!cfg || !cfg.endpoint) throw new Error('no AI endpoint');
  if (!prompt || !prompt.system || !prompt.user) throw new Error('no prompt');
  return _postAIModel(prompt, cfg);
}

async function _postAIModel(prompt, cfg) {
  if (!prompt || !prompt.system || !prompt.user) throw new Error('no prompt');
  const body = {
    model: cfg.model || 'qwen/qwen3.8-max',
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user }
    ],
    temperature: 0.4,
    max_tokens: 900
  };
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers['Authorization'] = 'Bearer ' + cfg.apiKey;
  const res = await fetch(cfg.endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error('AI HTTP ' + res.status + ' ' + txt.slice(0, 200));
  }
  const json = await res.json();
  const choice = json && json.choices && json.choices[0];
  const msg = choice && choice.message;
  // Reasoning models (e.g. qwen3.8-max) may return the answer in `reasoning`
  // instead of `content`; prefer content, fall back to reasoning.
  let text = (msg && msg.content) || (msg && msg.reasoning) || '';
  text = text.trim();
  if (!text) throw new Error('AI returned no content');
  return text;
}

/* ---------- named exports consumed by app.js / main.js ------------------ */
/* NOTE: Auth, Store, COL are already exported above via `export const`. */
export {
  // Pure helpers surfaced for unit/smoke testing (no behavior change to the app):
  // lets the Playwright suite assert the year-3995 guard against the REAL
  // toEpochSec instead of duplicating its logic in a script, and lets us unit-
  // test the null-safety guards added in t_7cbd0242 without re-implementing them.
  toEpochSec,
  avg, stddev, maxKey, minKey, computeTrend, maneuverTrendOf, extractThemes, omitId,
  buildPerformance, buildAIPrompt,
  buildSingleEvalData, buildSingleEvalPrompt,
  getAIConfig, callAIModel, callAIModelWithPrompt
};
