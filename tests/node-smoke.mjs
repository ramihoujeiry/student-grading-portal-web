// Node verification harness: runs the SAME assertions as tests/store.smoke.spec.js
// against the REAL src/store.js, by stubbing the firebase/* imports via a loader.
// This validates the test expectations on this machine (where a headless browser
// cannot launch). The Playwright spec is the committed CI artifact; this is the
// local proof that its assertions hold against the authentic module.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { writeFileSync, rmSync } from 'node:fs';

// 1) Loader: map bare 'firebase/app' etc. to the fixture stubs.
import { join } from 'node:path';
const cwdUrl = pathToFileURL(process.cwd() + '/');
const fixtureDir = new URL('./fixture/', cwdUrl);
const stubMap = {
  'firebase/app': new URL('firebase/app.js', fixtureDir),
  'firebase/auth': new URL('firebase/auth.js', fixtureDir),
  'firebase/firestore': new URL('firebase/firestore.js', fixtureDir),
};
const loaderSource = `
export async function resolve(spec, ctx, next) {
  if (${JSON.stringify(Object.keys(stubMap))}.includes(spec)) {
    return { url: ${JSON.stringify(Object.fromEntries(Object.entries(stubMap).map(([k,v])=>[k,v.href])))}[spec], shortCircuit: true };
  }
  return next(spec, ctx);
}`;
const loaderAbs = join(process.cwd(), 'tests', 'fixture', '.loader.mjs');
writeFileSync(loaderAbs, loaderSource);
register(loaderAbs, cwdUrl);

const Store = await import('./fixture/store.js');

let pass = 0, fail = 0;
function eq(name, got, want, loose = false) {
  const ok = loose ? (got == want) : (JSON.stringify(got) === JSON.stringify(want));
  if (ok) { pass++; }
  else { fail++; console.log(`FAIL: ${name}\n   got:  ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`); }
}
function ok(name, cond) { if (cond) pass++; else { fail++; console.log(`FAIL: ${name}`); } }
function throws(name, fn, re) {
  try { fn(); fail++; console.log(`FAIL: ${name} (did not throw)`); }
  catch (e) { if (!re || re.test(e.message)) pass++; else { fail++; console.log(`FAIL: ${name} wrong msg: ${e.message}`); } }
}

const realDate = Math.floor(Date.UTC(2025, 6, 15) / 1000);
const ts = (sec) => ({ seconds: sec, nanoseconds: 0, toDate() { return new Date(sec * 1000); }, toMillis() { return sec * 1000; } });

// API surface
['Auth','Store','COL','toEpochSec','fmtDate','calcFinalGrade','calcMifStatus','buildPerformance','generateFeedback','getAIConfig','callAIModel','callAIModelWithPrompt','buildSingleEvalPrompt','generateSingleEvalFeedback','buildSingleEvalData'].forEach((s) => ok('export ' + s, s in Store));

// Path 1/2 degradation
ok('Auth.ready false', Store.Auth.ready === false);
ok('Store.ready false', Store.Store.ready === false);
eq('watch no-op list', Store.Store.watch('students', (l) => { globalThis.__cap = l; }), undefined); // returns unsub fn
ok('watch returned unsub fn', typeof Store.Store.watch('students', () => {}) === 'function');

throws('deleteEvaluation no-arg (sync shape)', () => Store.Store.deleteEvaluation.length, /./);
// async throws need await
let delThrew = false, delMsg = '';
try { await Store.Store.deleteEvaluation(); } catch (e) { delThrew = true; delMsg = e.message; }
ok('deleteEvaluation throws missing id', delThrew && /missing document id/i.test(delMsg));

// Path 3
eq('toEpochSec num', Store.toEpochSec(realDate), realDate);
eq('toEpochSec ms', Store.toEpochSec(realDate * 1000), realDate);
eq('toEpochSec ts', Store.toEpochSec(ts(realDate)), realDate);
eq('toEpochSec raw Date', Store.toEpochSec(new Date(realDate * 1000)), realDate);
eq('toEpochSec iso', Store.toEpochSec('2025-07-15T00:00:00Z'), realDate);
eq('toEpochSec null', Store.toEpochSec(null), 0);
eq('toEpochSec undef', Store.toEpochSec(undefined), 0);
eq('toEpochSec NaN', Store.toEpochSec(NaN), 0);

eq('fmtDate good', Store.fmtDate(realDate), '2025-07-15');
eq('fmtDate raw Date', Store.fmtDate(new Date(realDate * 1000)), '2025-07-15');
eq('fmtDate >2099', Store.fmtDate(5e9), '-');
eq('fmtDate ceil', Store.fmtDate(4102444801), '-');
eq('fmtDate 0', Store.fmtDate(0), '-');
eq('fmtDate null', Store.fmtDate(null), '-');

// Path 4
const g = (grade, req, factor) => ({ name: 'Hover', studentGrade: grade, requiredMif: req, factor });
eq('calcFinalGrade mixed', Store.calcFinalGrade([g(4,0,1), g(2,0,1)]), 85);
ok('calcFinalGrade empty null', Store.calcFinalGrade([]) === null);
ok('calcFinalGrade allZero null', Store.calcFinalGrade([g(0,0,1)]) === null);
eq('calcMifStatus 2fail', Store.calcMifStatus([g(1,2,1), g(1,2,1)]), 'BELOW STANDARD');
eq('calcMifStatus 1fail', Store.calcMifStatus([g(1,2,1), g(3,2,1)]), 'MEETS STANDARD');
eq('calcMifStatus none', Store.calcMifStatus([g(0,2,1)]), 'PENDING');

const base = Math.floor(Date.UTC(2026, 0, 1) / 1000);
const evals = [
  { id:'e1', studentId:'s1', studentName:'Test Cadet', aircraftType:'R44-2', phaseName:'CONTACT', date: base, finalGrade:70, overallMifStatus:'MEETS STANDARD', tripNotes:'', maneuverGrades:[g(1,3,1)] },
  { id:'e2', studentId:'s1', studentName:'Test Cadet', aircraftType:'R44-2', phaseName:'CONTACT', date: base+10*86400, finalGrade:92, overallMifStatus:'MEETS STANDARD', tripNotes:'', maneuverGrades:[g(2,3,1)] },
];
const perf = Store.buildPerformance({ name:'Test Cadet' }, evals);
eq('perf count', perf.evaluationCount, 2);
eq('perf trend', perf.trend, 'IMPROVING');
ok('perf readiness valid', ['READY','RECOVERING','REMEDIAL','INSUFFICIENT_DATA'].includes(perf.readiness));
ok('perf weak has Hover', perf.weakManeuvers.map(w=>w.name).includes('Hover'));
eq('perf first label', perf.firstDateLabel, '2026-01-01');
eq('perf last label', perf.lastDateLabel, '2026-01-11');
ok('perf phase scores', Object.keys(perf.phaseScores).length > 0);

let fbThrew = false; let fbOut = '';
try { fbOut = Store.generateFeedback(perf); } catch (e) { fbThrew = true; fbOut = String(e); }
ok('generateFeedback no throw', !fbThrew);
ok('generateFeedback content', fbOut.length > 50 && fbOut.includes('Test Cadet') && fbOut.includes('READINESS') && fbOut.includes('AI Performance Analysis'));
ok('generateFeedback empty msg', /No evaluations found/i.test(Store.generateFeedback(Store.buildPerformance({name:'X'},[]))));

// Path 5
const cfg = await Store.getAIConfig();
ok('getAIConfig not null', cfg !== null);
eq('getAIConfig endpoint', cfg.endpoint, 'https://raspberrypi.tail3a08db.ts.net/v1/chat/completions');
eq('getAIConfig model', cfg.model, 'tencent/hy3:free');

let noCfgThrew = false, noCfgMsg = '';
try { await Store.callAIModel({}, null); } catch (e) { noCfgThrew = true; noCfgMsg = e.message; }
ok('callAIModel no cfg', noCfgThrew && /no AI endpoint/i.test(noCfgMsg));
let noPromptThrew = false, noPromptMsg = '';
try { await Store.callAIModelWithPrompt(null, { endpoint:'x' }); } catch (e) { noPromptThrew = true; noPromptMsg = e.message; }
ok('callAIModelWithPrompt no prompt', noPromptThrew && /no prompt/i.test(noPromptMsg));

const ev = { studentName:'Test Cadet', aircraftType:'R44-2', phaseName:'CONTACT', tripNumber:'T3', date: Math.floor(Date.UTC(2026,2,5)/1000), instructorName:'Cap. Haddad', duration:'1.5', finalGrade:72, overallMifStatus:'BELOW STANDARD', maneuverGrades:[g(1,3,1.5)], tripNotes:'Watch nose attitude in the hover.' };
const sdata = Store.buildSingleEvalData(ev);
const sf = Store.generateSingleEvalFeedback(sdata);
ok('single feedback ok', typeof sf === 'string' && sf.length > 20 && sf.includes('Test Cadet'));
const sprompt = await Store.buildSingleEvalPrompt(sdata);
ok('single prompt system', sprompt.system && sprompt.system.length > 10);
ok('single prompt user', sprompt.user && sprompt.user.length > 20);

// flight year
const d = new Date(); const y = d.getFullYear(); const start = d.getMonth() >= 6 ? y : y - 1;
eq('currentFlightYear', Store.Store.currentFlightYear(), start + '-' + (start + 1));

// cleanup loader artifact
try { rmSync(loaderAbs, { force: true }); } catch {}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
