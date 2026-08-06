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
 * Grading math / AI feedback functions are kept from the previous local build.
 * ========================================================================= */

/* ---------- Firebase bootstrap (gated on a real config) ------------------ */
let auth = null, dbFs = null, fbReady = false;
if (typeof FIREBASE_CONFIG !== 'undefined' && FIREBASE_READY) {
  firebase.initializeApp(FIREBASE_CONFIG);
  auth = firebase.auth();
  dbFs = firebase.firestore();
  fbReady = true;
}

/* ---------- constants (mirror Android Constants.kt) --------------------- */
const STATUS_MEETS_STANDARD = 'MEETS STANDARD';
const STATUS_BELOW_STANDARD = 'BELOW STANDARD';
const STATUS_PENDING = 'PENDING';
const GRADE_SCORE = { 0: 0, 1: 65, 2: 75, 3: 85, 4: 95 };

const COL = {
  users: 'users', students: 'students', instructors: 'instructors',
  aircraft: 'aircraft', mifTables: 'mif_tables', evaluations: 'evaluations',
  announcements: 'announcements'
};

/* ---------- AI backend (LAN default = Hermes gateway proxy on the Pi) ------ */
/* The Pi (pi@192.168.1.200) runs ai_proxy.py exposing an OpenAI-compatible
   /v1/chat/completions endpoint that forwards to OpenRouter using the key
   stored in /home/pi/.hermes/.env (key never reaches the browser). Used when
   no Firestore config/ai doc is set. For cloud use, set config/ai (admin-
   only write) and this LAN default is ignored. */
const LAN_AI_ENABLED = true;
const LAN_AI_ENDPOINT = 'https://192.168.1.200:8787/v1/chat/completions';
const LAN_AI_MODEL = 'meta-llama/llama-3.1-8b-instruct';

/* ---------- auth service ------------------------------------------------- */
const Auth = {
  ready: fbReady,
  onUser(cb) { if (!fbReady) return () => {}; return auth.onAuthStateChanged(cb); },

  async login(email, password) {
    const u = await auth.signInWithEmailAndPassword(email, password);
    if (u.user && !u.user.emailVerified) {
      await auth.signOut();
      throw new Error('Please verify your email before logging in. Check your inbox.');
    }
    return u;
  },
  async register(email, password, fullName) {
    const u = await auth.createUserWithEmailAndPassword(email, password);
    if (u.user) {
      await u.user.sendEmailVerification();
      await dbFs.collection(COL.users).doc(u.user.uid).set({
        uid: u.user.uid, name: fullName, email: email, role: 'pending'
      });
    }
    return u;
  },
  async logout() { if (fbReady) await auth.signOut(); },
  async roleOf(uid) {
    if (!fbReady || !uid) return 'pending';
    const doc = await dbFs.collection(COL.users).doc(uid).get();
    return (doc.exists && doc.data().role) || 'pending';
  }
};

/* ---------- data service (CRUD + listeners) ----------------------------- */
const Store = {
  ready: fbReady,
  _unsubs: [],

  // generic realtime collection -> callback(list)
  watch(collection, cb, opts = {}) {
    if (!fbReady) { cb([]); return () => {}; }
    let q = dbFs.collection(collection);
    if (opts.orderBy) q = q.orderBy(opts.orderBy, opts.dir || 'asc');
    const unsub = q.onSnapshot(snap => {
      let list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (opts.activeOnly) list = list.filter(x => x.active);
      cb(list);
    }, err => { console.error('watch', collection, err); cb([]); });
    this._unsubs.push(unsub);
    return unsub;
  },

  // students
  async addStudent(name) {
    await dbFs.collection(COL.students).add({ name, active: true, activeYears: ['2025-2026'], createdAt: Date.now() / 1000 });
  },
  async setStudentActive(id, active) { await dbFs.collection(COL.students).doc(id).update({ active }); },
  async deleteStudent(id) { await dbFs.collection(COL.students).doc(id).delete(); },

  // instructors
  async addInstructor(name) { await dbFs.collection(COL.instructors).add({ name, active: true, createdAt: Date.now() / 1000 }); },
  async setInstructorActive(id, active) { await dbFs.collection(COL.instructors).doc(id).update({ active }); },
  async deleteInstructor(id) { await dbFs.collection(COL.instructors).doc(id).delete(); },

  // aircraft
  async addAircraft(name) { await dbFs.collection(COL.aircraft).add({ name }); },
  async deleteAircraft(id) { await dbFs.collection(COL.aircraft).doc(id).delete(); },

  // mif tables (doc id = aircraftType + '_' + phaseName, like Android)
  async addMifTable(aircraftType, phaseName, stages) {
    const id = aircraftType + '_' + phaseName;
    await dbFs.collection(COL.mifTables).doc(id).set({ aircraftType, phaseName, stages, maneuvers: [], updatedAt: Date.now() / 1000 });
  },
  async addManeuver(tableId, maneuver) {
    const ref = dbFs.collection(COL.mifTables).doc(tableId);
    const doc = await ref.get();
    const maneuvers = (doc.exists && doc.data().maneuvers) || [];
    maneuvers.push(maneuver);
    await ref.update({ maneuvers });
  },
  async deleteManeuver(tableId, idx) {
    const ref = dbFs.collection(COL.mifTables).doc(tableId);
    const doc = await ref.get();
    const maneuvers = (doc.exists && doc.data().maneuvers) || [];
    maneuvers.splice(idx, 1);
    await ref.update({ maneuvers });
  },
  async deleteMifTable(tableId) { await dbFs.collection(COL.mifTables).doc(tableId).delete(); },

  // evaluations
  async saveEvaluation(ev) {
    if (!ev.id) ev.id = dbFs.collection(COL.evaluations).doc().id;
    const clean = { ...ev, instructorUid: (auth.currentUser && auth.currentUser.uid) || '' };
    await dbFs.collection(COL.evaluations).doc(ev.id).set(clean);
    return ev.id;
  },
  async deleteEvaluation(id) { await dbFs.collection(COL.evaluations).doc(id).delete(); },

  // announcements
  async addAnnouncement(a) { await dbFs.collection(COL.announcements).add(a); },
  async deleteAnnouncement(id) { await dbFs.collection(COL.announcements).doc(id).delete(); },

  // users (admin only) — mirrors Android UserManagementViewModel
  async approveUser(uid, role) {
    await dbFs.collection(COL.users).doc(uid).update({ role, updatedAt: Date.now() / 1000 });
  },
  async updateUserRole(uid, role) {
    await dbFs.collection(COL.users).doc(uid).update({ role, updatedAt: Date.now() / 1000 });
  },
  async deleteUser(uid) {
    // native rejects (removes) the user doc; auth account stays until re-login, matching Android rejectUser
    await dbFs.collection(COL.users).doc(uid).delete();
  },

  // first-run seeding (admin only). Mirrors the sample data for an empty project.
  async seedIfEmpty(user) {
    if (!fbReady) return;
    const snap = await dbFs.collection(COL.students).limit(1).get();
    if (!snap.empty) return;
    const batch = dbFs.batch();
    const seed = JSON.parse(JSON.stringify(SEED));
    seed.students.forEach(s => batch.set(dbFs.collection(COL.students).doc(s.id), omitId(s)));
    seed.instructors.forEach(i => batch.set(dbFs.collection(COL.instructors).doc(i.id), omitId(i)));
    seed.aircraft.forEach(a => batch.set(dbFs.collection(COL.aircraft).doc(a.id), omitId(a)));
    seed.mifTables.forEach(t => batch.set(dbFs.collection(COL.mifTables).doc(t.aircraftType + '_' + t.phaseName), omitId(t)));
    seed.evaluations.forEach(e => batch.set(dbFs.collection(COL.evaluations).doc(e.id), omitId(e)));
    seed.announcements.forEach(an => batch.set(dbFs.collection(COL.announcements).doc(an.id), omitId(an)));
    await batch.commit();
  }
};

function omitId(o) { const { id, ...rest } = o; return rest; }

/* ---------- grading math (ported 1:1 from Android) ---------------------- */
function calcFinalGrade(maneuverGrades) {
  if (!maneuverGrades || maneuverGrades.length === 0) return null;
  const graded = maneuverGrades.filter(m => m.studentGrade != null && m.studentGrade !== 0);
  if (graded.length === 0) return null;
  let tw = 0, w = 0;
  for (const m of graded) {
    const score = GRADE_SCORE[m.studentGrade] || 0;
    if (score > 0) { tw += score * m.factor; w += m.factor; }
  }
  if (w === 0) return null;
  return Math.round((tw / w) * 1000) / 1000;
}
function calcMifStatus(maneuverGrades) {
  const any = (maneuverGrades || []).some(m => m.studentGrade != null && m.studentGrade !== 0);
  if (!any) return STATUS_PENDING;
  let fail = 0;
  for (const m of maneuverGrades) if (m.studentGrade != null && m.studentGrade !== 0 && m.requiredMif != null && m.studentGrade < m.requiredMif) fail++;
  return fail >= 2 ? STATUS_BELOW_STANDARD : STATUS_MEETS_STANDARD;
}

/* ---------- AI feedback (ported from AIFeedbackGenerator.kt) ------------- */
const STOP_WORDS = new Set(('the a an and or to of in on for with is are was were been be this that it at as by from ' +
  'he she they you we my your their not no but if so do did has have had will would can could should very more than ' +
  'into out up down about his her its our them then there also after before when while which who what how why').split(' '));

function ol(s){return s>=90?'Excellent':s>=75?'Good':s>=60?'Satisfactory':'Needs improvement';}
function tl(t){return t==='IMPROVING'?'Improving':t==='DECLINING'?'Declining':'Stable';}
function vl(v){return v<3?'Steady':v<8?'Variable':'Inconsistent';}
function rl(r){return r==='READY'?'Ready to progress / consolidate':r==='RECOVERING'?'Recovering - keep current plan':r==='REMEDIAL'?'Remedial focus needed':'Insufficient data for a confident verdict';}
function fmtDate(sec){if(!sec)return '-';const d=new Date(sec*1000);return d.toISOString().slice(0,10);}

function avg(a){return a.reduce((s,x)=>s+x,0)/a.length;}
function stddev(a){const m=avg(a);return Math.sqrt(a.map(x=>(x-m)*(x-m)).reduce((s,x)=>s+x,0)/a.length);}
function maxKey(o){let bk=null,bv=-Infinity;Object.keys(o).forEach(k=>{if(o[k]>bv){bv=o[k];bk=k;}});return bk;}
function minKey(o){let bk=null,bv=Infinity;Object.keys(o).forEach(k=>{if(o[k]<bv){bv=o[k];bk=k;}});return bk;}
function computeTrend(sorted){
  if(sorted.length<2)return{t:'STABLE',d:0};
  const half=Math.floor(sorted.length/2);
  const first=avg(sorted.slice(0,half).map(e=>e.finalGrade));
  const second=avg(sorted.slice(half).map(e=>e.finalGrade));
  const d=second-first;
  return d>=3?{t:'IMPROVING',d}:d<=-3?{t:'DECLINING',d}:{t:'STABLE',d};
}
function maneuverTrendOf(by){
  const half=Math.floor(by.length/2);
  const first=avg(by.slice(0,half).map(p=>p[1]));
  const second=avg(by.slice(half).map(p=>p[1]));
  const d=second-first;
  return d>=5?'IMPROVING':d<=-5?'DECLINING':'FLAT';
}
function extractThemes(notes){
  const counts={};
  notes.forEach(n=>n.toLowerCase().split(/[^a-z]+/).forEach(w=>{if(w.length>=4&&!STOP_WORDS.has(w))counts[w]=(counts[w]||0)+1;}));
  return Object.keys(counts).sort((a,b)=>counts[b]-counts[a]).slice(0,5);
}

function buildPerformance(student, evals){
  const sorted=evals.slice().sort((a,b)=>(a.date||0)-(b.date||0));
  const overallScore=sorted.length?avg(sorted.map(e=>e.finalGrade)):0;
  const grades=sorted.map(e=>e.finalGrade);
  const volatility=grades.length>=2?stddev(grades):0;
  const trend=computeTrend(sorted);
  const sums={},weights={},requiredMap={};
  sorted.forEach(ev=>(ev.maneuverGrades||[]).forEach(m=>{
    const w=Math.max(m.factor,0.01);
    sums[m.name]=(sums[m.name]||0)+m.studentGrade*w;
    weights[m.name]=(weights[m.name]||0)+w;
    if(m.requiredMif>0)requiredMap[m.name]=m.requiredMif;
  }));
  const practicalScores={};
  Object.keys(sums).forEach(n=>{practicalScores[n]=sums[n]/(weights[n]||1);});
  const series={};
  sorted.forEach(ev=>(ev.maneuverGrades||[]).forEach(m=>{(series[m.name]=series[m.name]||[]).push([ev.date||0,m.studentGrade]);}));
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
  return{studentName:student.name,overallScore,trend:trend.t,trendDelta:trend.d,volatility,
    practicalScores,weakManeuvers,maneuverTrends,phaseScores,bestManeuver,worstManeuver,overallMifStatus,
    instructorNotes,noteThemes,readiness,tripCount:sorted.length,
    firstDateLabel:fmtDate(firstDate),lastDateLabel:fmtDate(lastDate),
    spanDays:sorted.length?Math.floor((lastDate-firstDate)/86400):0,evaluationCount:sorted.length};
}

function generateFeedback(data){
  if(!data.evaluationCount)return 'No evaluations found for '+(data.studentName||'this student')+'.\nOpen a student profile from a completed trip to generate feedback.';
  const L=[];const name=data.studentName||'the cadet';
  L.push('AI Performance Analysis - '+name);
  L.push(data.evaluationCount+' trip(s) | '+data.firstDateLabel+' -> '+data.lastDateLabel);
  if(data.spanDays>0)L.push('  ~'+(data.tripCount/Math.max(data.spanDays/30,1)).toFixed(1)+' trips/mo');
  L.push('');
  L.push('OVERALL: '+ol(data.overallScore)+' (avg '+data.overallScore.toFixed(1)+')');
  L.push('Trend: '+tl(data.trend)+(data.evaluationCount>=2?' ('+Math.abs(data.trendDelta).toFixed(1)+' pts '+(data.trendDelta>=0?'up':'down')+')':''));
  L.push('Consistency: '+vl(data.volatility)+' (std '+data.volatility.toFixed(1)+')');
  if(data.overallMifStatus)L.push('MIF status: '+data.overallMifStatus);
  L.push('');
  if(data.bestManeuver&&(data.practicalScores[data.bestManeuver]||0)>=70)L.push('STRENGTH: '+data.bestManeuver+' (avg '+data.practicalScores[data.bestManeuver].toFixed(1)+')');
  L.push('');
  if(data.weakManeuvers.length){L.push('PRIORITY TO IMPROVE:');data.weakManeuvers.slice(0,5).forEach(w=>{const tag=w.belowRequired?'below required MIF '+w.requiredMif:'below pass mark';const tr=w.trend==='IMPROVING'?'improving':w.trend==='DECLINING'?'STILL DECLINING':'flat';L.push('- '+w.name+': avg '+w.avgGrade.toFixed(1)+' ('+tag+') - '+tr);});L.push('');}
  else if(data.worstManeuver)L.push('Lowest scoring area: '+data.worstManeuver+' (avg '+data.practicalScores[data.worstManeuver].toFixed(1)+')\n');
  if(Object.keys(data.phaseScores).length){L.push('PHASE AVERAGES:');Object.keys(data.phaseScores).sort().forEach(p=>L.push('- '+p+': '+data.phaseScores[p].toFixed(1)));L.push('');}
  if(data.noteThemes.length)L.push('RECURRING COACH THEMES: '+data.noteThemes.join(', '));
  L.push('');
  L.push('READINESS: '+rl(data.readiness));L.push('');
  L.push('ACS FRAMEWORK (Knowledge + Risk Mgmt + Skill):');
  if(data.weakManeuvers.length)L.push('- Skill: below standard on '+data.weakManeuvers[0].name+' - remediate before advancing.');
  else L.push('- Skill: at/above standard across evaluated maneuvers.');
  if(data.trend==='DECLINING'||data.volatility>8)L.push('- Risk Mgmt: unstable performance - brief hazards and personal minimums before the next trip.');
  else L.push('- Risk Mgmt: stable - maintain standard operating routines.');
  if(data.noteThemes.length||data.instructorNotes.some(n=>/watch|caution|unsafe/i.test(n)))L.push('- Knowledge: gaps flagged in notes ('+data.noteThemes.slice(0,3).join(', ')+').');
  else L.push('- Knowledge: no recurring gaps flagged.');
  L.push('');
  L.push('FOR THE INSTRUCTOR - NEXT TRIP:');
  if(!data.weakManeuvers.length)L.push('- No failing maneuvers against standard. Keep current coaching; introduce advanced scenarios to stretch the cadet.');
  else{const top=data.weakManeuvers[0];L.push("- Next trip: demonstrate '"+top.name+"' to standard, then guided practice, then solo - do not advance until consistently at "+top.requiredMif+'+.');L.push('- Give cockpit attention to: '+data.weakManeuvers.slice(0,3).map(w=>w.name).join(', ')+'.');const dec=data.weakManeuvers.filter(w=>w.trend==='DECLINING');if(dec.length)L.push("- "+dec[0].name+' is still declining: change the teaching technique (demonstrate the correct feel), not just more repetition.');if(data.trend==='DECLINING')L.push('- Trend is down. Run a standardisation/recurrency check before progressing phases; remediate the weak fundamental first.');else if(data.trend==='IMPROVING')L.push('- Momentum is good. Let the cadet lead more; reduce instructor inputs on strengths to build airmanship.');if(data.volatility>8)L.push('- Grades are inconsistent (high variance). Focus on repeatability and "feel of the airplane" before advancing.');if(data.instructorNotes.some(n=>/watch|caution|unsafe/i.test(n)))L.push('- Prioritise the safety items flagged in previous notes before adding new tasks.');L.push('- After each sortie, review with the cadet using ADM: what happened, why, and the correction.');if(data.volatility>8||data.trend==='DECLINING'||data.instructorNotes.some(n=>/watch|caution|unsafe/i.test(n)))L.push('- Run a PAVE brief (Pilot, Aircraft, EnVironment, External) before the next trip; set personal minimums for the weak area.');}
  L.push('');
  L.push('TRAINING PLAN - WHAT THE CADET SHOULD DO:');
  if(!data.weakManeuvers.length)L.push('- Maintain current rhythm. Practise variations of strong maneuvers to build consistency and airmanship.');
  else{data.weakManeuvers.slice(0,3).forEach(w=>L.push("- Drill '"+w.name+"' (avg "+w.avgGrade.toFixed(1)+'): chair-fly + repeat to standard until steady at '+w.requiredMif+'+.'));L.push('- Use simulator / chair-flying for the weakest item(s) before the next flight.');if(data.trend==='DECLINING')L.push('- Slow the pace: consolidate the fundamentals rather than advancing to new material.');else if(data.trend==='IMPROVING')L.push('- Keep the current study cadence; it is paying off.');if(data.noteThemes.length)L.push('- Re-study ground theory for: '+data.noteThemes.slice(0,3).join(', ')+' (flagged in instructor notes).');L.push('- Self-grade each session against the required MIF and log what improved.');}
  L.push('');
  L.push('METHOD (FAA AIH / CFI ACS / Risk Mgmt Hbk): demonstrate, then guided practice, then solo.');
  L.push('Grade against ACS (Knowledge + Risk Mgmt + Skill); remediate weak fundamentals before advancing.');
  return L.join('\n');
}

/* ---------- Online AI adapter (OpenAI-compatible /chat/completions) ------- */
/* Loaded from Firestore config/ai so no key is committed to the repo.
   Expected doc shape:
     { enabled:true, endpoint:"https://.../v1/chat/completions",
       model:"qwen/qwen3.8-max", apiKey:"sk-..." }
   Falls back to the offline template (generateFeedback) if unset or on error. */
async function getAIConfig() {
  // 1) Cloud config (admin-set, overrides LAN default) — only if Firestore rules allow read
  if (fbReady) {
    try {
      const snap = await dbFs.collection('config').doc('ai').get();
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
   real signal to work with (not just "write something nice"). */
function buildAIPrompt(data) {
  const sys = 'You are a senior flight instructor (CFI) writing a concise, candid coaching debrief for a student pilot. ' +
    'Use the data provided. Be specific and actionable. Do NOT invent grades or maneuvers that are not in the data. ' +
    'Write in plain language a human instructor would say. Use short paragraphs. End with concrete next-trip actions.';
  const L = [];
  L.push('Student: ' + (data.studentName || 'cadet'));
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
  return { system: sys, user: L.join('\n') };
}

/* Call an OpenAI-compatible chat-completions endpoint. Returns model text. Throws on failure. */
async function callAIModel(data, cfg) {
  if (!cfg || !cfg.endpoint) throw new Error('no AI endpoint');
  const prompt = buildAIPrompt(data);
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
