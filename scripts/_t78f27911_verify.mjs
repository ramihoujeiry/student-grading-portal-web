// Independent verification for kanban t_78f27911.
// Exercises the REAL exported store.js functions with null/empty/partial AND
// null-element-in-array inputs (the class that blanked the app in c8c9d3a).
// Asserts: nothing throws, and Timestamp math never yields an impossible year.

import {
  toEpochSec, avg, stddev, maxKey, minKey, computeTrend, maneuverTrendOf,
  extractThemes, omitId, buildPerformance, generateFeedback, buildAIPrompt,
  buildSingleEvalData, generateSingleEvalFeedback, buildSingleEvalPrompt,
  getAIConfig, callAIModel, callAIModelWithPrompt, calcFinalGrade,
  calcMifStatus, fmtDate
} from '../src/store.js';

let pass = 0, fail = 0;
async function run(name, fn) {
  try { const r = await fn(); pass++; return r; }
  catch (e) { fail++; console.log(`THROW FAIL: ${name} => ${e && e.message}`); return undefined; }
}
function eq(name, got, want) {
  if (got === want) pass++;
  else { fail++; console.log(`VALUE FAIL: ${name} => got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
}

(async () => {
  // ---- pure math helpers ----
  eq('avg null', await run('avg null', () => avg(null)), 0);
  eq('avg undefined', await run('avg undefined', () => avg(undefined)), 0);
  eq('avg empty', await run('avg empty', () => avg([])), 0);
  eq('avg nums', await run('avg nums', () => avg([1,2,3])), 2);
  await run('avg NaN elem', () => avg([1,NaN,3]));
  eq('stddev null', await run('stddev null', () => stddev(null)), 0);
  eq('stddev empty', await run('stddev empty', () => stddev([])), 0);
  eq('stddev nums', await run('stddev nums', () => stddev([2,4,4,4,5,5,7,9])), 2);
  eq('maxKey null', await run('maxKey null', () => maxKey(null)), null);
  eq('maxKey empty', await run('maxKey empty', () => maxKey({})), null);
  eq('maxKey normal', await run('maxKey normal', () => maxKey({a:1,b:9,c:3})), 'b');
  eq('minKey null', await run('minKey null', () => minKey(null)), null);
  eq('minKey empty', await run('minKey empty', () => minKey({})), null);
  eq('minKey normal', await run('minKey normal', () => minKey({a:1,b:9,c:3})), 'a');

  // ---- trend helpers (null ELEMENT inside array) ----
  eq('computeTrend null', (await run('computeTrend null', () => computeTrend(null))).t, 'STABLE');
  eq('computeTrend short', (await run('computeTrend short', () => computeTrend([{finalGrade:80}]))).t, 'STABLE');
  eq('computeTrend empty', (await run('computeTrend empty', () => computeTrend([]))).t, 'STABLE');
  eq('computeTrend nullElem', (await run('computeTrend nullElem', () => computeTrend([null, {finalGrade:80}, {finalGrade:90}]))).t, 'IMPROVING');
  eq('maneuverTrendOf null', await run('maneuverTrendOf null', () => maneuverTrendOf(null)), 'FLAT');
  eq('maneuverTrendOf short', await run('maneuverTrendOf short', () => maneuverTrendOf([[1,80]])), 'FLAT');
  eq('maneuverTrendOf empty', await run('maneuverTrendOf empty', () => maneuverTrendOf([])), 'FLAT');
  eq('maneuverTrendOf nullElem', await run('maneuverTrendOf nullElem', () => maneuverTrendOf([null, [1,80], [2,90]])), 'IMPROVING');
  eq('extractThemes null', (await run('extractThemes null', () => extractThemes(null))).length, 0);
  eq('extractThemes empty', (await run('extractThemes empty', () => extractThemes([]))).length, 0);
  eq('extractThemes nullElem', (await run('extractThemes nullElem', () => extractThemes([null, 'good consistent landing', 'good consistent approach']))).length >= 0, true);
  eq('extractThemes undefElem', (await run('extractThemes undefElem', () => extractThemes([undefined, 'good consistent landing']))).length >= 0, true);

  // ---- omitId ----
  eq('omitId null', JSON.stringify(await run('omitId null', () => omitId(null))), '{}');
  eq('omitId normal', JSON.stringify(await run('omitId normal', () => omitId({id:'x',a:1}))), '{"a":1}');

  // ---- calc* ----
  eq('calcFinalGrade null', await run('calcFinalGrade null', () => calcFinalGrade(null)), null);
  eq('calcFinalGrade empty', await run('calcFinalGrade empty', () => calcFinalGrade([])), null);
  eq('calcFinalGrade zero', await run('calcFinalGrade zero', () => calcFinalGrade([{studentGrade:0,factor:1}])), null);
  await run('calcFinalGrade nullElem', () => calcFinalGrade([null,{studentGrade:3,factor:1}]));
  eq('calcMifStatus null', await run('calcMifStatus null', () => calcMifStatus(null)), 'PENDING');
  eq('calcMifStatus empty', await run('calcMifStatus empty', () => calcMifStatus([])), 'PENDING');
  eq('calcMifStatus nullElem', await run('calcMifStatus nullElem', () => calcMifStatus([null,{studentGrade:1,factor:1,requiredMif:3}])), 'MEETS STANDARD');

  // ---- fmtDate (year-3995 guard) ----
  eq('fmtDate null', await run('fmtDate null', () => fmtDate(null)), '-');
  eq('fmtDate undefined', await run('fmtDate undefined', () => fmtDate(undefined)), '-');
  eq('fmtDate NaN', await run('fmtDate NaN', () => fmtDate(NaN)), '-');
  eq('fmtDate Date obj', await run('fmtDate Date', () => fmtDate(new Date(Date.UTC(2025,6,15)))), '2025-07-15');
  eq('fmtDate TS', await run('fmtDate TS', () => fmtDate({seconds: Date.UTC(2025,6,15)/1000})), '2025-07-15');
  eq('fmtDate rawDate', await run('fmtDate rawDate', () => fmtDate(new Date(Date.UTC(2025,6,15)))), '2025-07-15');
  eq('fmtDate impossible', await run('fmtDate big', () => fmtDate(toEpochSec({seconds: 5000000000}))), '-'); // ~year 2128 -> rejected
  eq('toEpochSec null', await run('toEpochSec null', () => toEpochSec(null)), 0);
  eq('toEpochSec invalid', await run('toEpochSec str', () => toEpochSec('not a date')), 0);
  eq('toEpochSec ms', await run('toEpochSec ms', () => toEpochSec(Date.UTC(2025,6,15))), Date.UTC(2025,6,15)/1000);

  // ---- buildPerformance (null student, null evals, null maneuver element, null eval element, null date) ----
  const bp1 = await run('buildPerformance null', () => buildPerformance(null, null));
  eq('bp null shape', typeof bp1, 'object');
  eq('bp null overallScore', bp1.overallScore, 0);
  eq('bp null name', bp1.studentName, '');
  const bp2 = await run('buildPerformance nullelem', () => buildPerformance({name:'S'}, [null, {finalGrade:80, maneuverGrades:[null,{name:'x',studentGrade:3,factor:1,requiredMif:3}]}]));
  eq('bp nullelem shape', typeof bp2, 'object');
  eq('bp nullelem tripCount', bp2.tripCount >= 1, true);
  const bp3 = await run('buildPerformance TSdate', () => buildPerformance({name:'S'}, [{finalGrade:80, date:{seconds:Date.UTC(2025,6,15)/1000}, maneuverGrades:[]}]));
  eq('bp TSdate label', bp3.firstDateLabel, '2025-07-15');
  const bp4 = await run('buildPerformance nullDate', () => buildPerformance({name:'S'}, [{finalGrade:80, date:null, maneuverGrades:[]}]));
  eq('bp nullDate label', bp4.firstDateLabel, '-');

  // ---- generateFeedback (async) ----
  const gfNull = await run('generateFeedback null', () => generateFeedback(null));
  eq('generateFeedback null', gfNull.includes('No evaluations'), true);
  const gfPartial = await run('generateFeedback partial', () => generateFeedback({studentName:'Cadet', overallScore:82}));
  eq('generateFeedback partial shape', typeof gfPartial, 'string');
  eq('generateFeedback partial name', gfPartial.includes('Cadet'), true);

  // ---- buildAIPrompt (async) ----
  const ap = await run('buildAIPrompt null', () => buildAIPrompt(null));
  eq('buildAIPrompt null shape', (ap.system && ap.user) ? 'ok' : 'bad', 'ok');
  const ap2 = await run('buildAIPrompt partial', () => buildAIPrompt({studentName:'Cadet'}));
  eq('buildAIPrompt partial shape', (ap2.system && ap2.user) ? 'ok' : 'bad', 'ok');

  // ---- single eval builders ----
  const sed = await run('buildSingleEvalData null', () => buildSingleEvalData(null));
  eq('sed null name', sed.studentName, undefined);
  const sed2 = await run('buildSingleEvalData nullGrades', () => buildSingleEvalData({studentName:'C', maneuverGrades:null}));
  eq('sed nullGrades grades', Array.isArray(sed2.grades), true);
  const sed3 = await run('buildSingleEvalData tsDate', () => buildSingleEvalData({studentName:'C', date:{seconds:Date.UTC(2025,6,15)/1000}, maneuverGrades:[]}));
  eq('sed tsDate label', sed3.date, '2025-07-15');
  await run('buildSingleEvalData nullElem', () => buildSingleEvalData({studentName:'C', maneuverGrades:[null,{name:'x',studentGrade:3,factor:1,requiredMif:3}]}));
  const sef = await run('generateSingleEvalFeedback null', () => generateSingleEvalFeedback(null));
  eq('sef null shape', typeof sef, 'string');
  const sepPromise = buildSingleEvalPrompt(null); // not awaited: must be a thenable
  eq('sep null isPromise', (sepPromise && typeof sepPromise.then === 'function'), true);
  const sepRes = await run('buildSingleEvalPrompt null await', () => sepPromise);
  eq('sep null resolved shape', (sepRes && sepRes.system && sepRes.user) ? 'ok' : 'bad', 'ok');

  // ---- callAIModel / callAIModelWithPrompt (cfg guards) ----
  eq('callAIModel noCfg', await (async () => { try { await callAIModel({}, null); return 'no-throw'; } catch(e){ return e.message; } })(), 'no AI endpoint');
  eq('callAIModelWithPrompt noPrompt', await (async () => { try { await callAIModelWithPrompt(null, {endpoint:'x'}); return 'no-throw'; } catch(e){ return e.message; } })(), 'no prompt');

  // ---- getAIConfig (async) ----
  const cfg = await run('getAIConfig', () => getAIConfig());
  eq('getAIConfig returns', (cfg === null || (cfg && typeof cfg.endpoint === 'string')), true);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
