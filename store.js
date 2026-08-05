/* =========================================================================
 * store.js — client-side persistence + grading math + AI feedback.
 * Replaces Firebase. Data lives in localStorage; JSON import/export for portability.
 * Grading math is ported 1:1 from the Android app (MainActivity.calculateFinalGrade
 * + updateSummary) so the web app produces identical grades.
 * ========================================================================= */

const STATUS_MEETS_STANDARD = 'MEETS STANDARD';
const STATUS_BELOW_STANDARD = 'BELOW STANDARD';
const STATUS_PENDING = 'PENDING';

const GRADE_SCORE = { 0: 0, 1: 65, 2: 75, 3: 85, 4: 95 };

const DB_KEY = 'grading-portal-v1';

/* ---- persistence -------------------------------------------------------- */
function loadDB() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* fall through to seed */ }
  // first run: clone seed
  const seeded = JSON.parse(JSON.stringify(SEED));
  localStorage.setItem(DB_KEY, JSON.stringify(seeded));
  return seeded;
}

let DB = loadDB();

function persist() {
  localStorage.setItem(DB_KEY, JSON.stringify(DB));
}

function resetDB() {
  DB = JSON.parse(JSON.stringify(SEED));
  persist();
  return DB;
}

function uid(prefix) {
  return prefix + '_' + Math.random().toString(36).slice(2, 9);
}

/* ---- grading math (ported from Android) --------------------------------- */
// maneuverGrades: [{name, factor, requiredMif, studentGrade}]
function calcFinalGrade(maneuverGrades) {
  if (!maneuverGrades || maneuverGrades.length === 0) return null;
  const graded = maneuverGrades.filter(m => m.studentGrade != null && m.studentGrade !== 0);
  if (graded.length === 0) return null;
  let totalWeighted = 0, totalWeight = 0;
  for (const m of graded) {
    const score = GRADE_SCORE[m.studentGrade] || 0;
    if (score > 0) {
      totalWeighted += score * m.factor;
      totalWeight += m.factor;
    }
  }
  if (totalWeight === 0) return null;
  return Math.round((totalWeighted / totalWeight) * 1000) / 1000;
}

// overall MIF status: compares each graded maneuver to its required MIF.
function calcMifStatus(maneuverGrades) {
  const anyGrades = (maneuverGrades || []).some(m => m.studentGrade != null && m.studentGrade !== 0);
  if (!anyGrades) return STATUS_PENDING;
  let failCount = 0;
  for (const m of maneuverGrades) {
    if (m.studentGrade != null && m.requiredMif != null && m.studentGrade < m.requiredMif) failCount++;
  }
  return failCount >= 2 ? STATUS_BELOW_STANDARD : STATUS_MEETS_STANDARD;
}

/* ---- student performance analysis + AI feedback (ported from AIFeedbackGenerator.kt) ---- */
const STOP_WORDS = new Set(('the a an and or to of in on for with is are was were been be this that it at as by from ' +
  'he she they you we my your their not no but if so do did has have had will would can could should very more than ' +
  'into out up down about his her its our them then there also after before when while which who what how why').split(' '));

function overallLabel(s) { return s >= 90 ? 'Excellent' : s >= 75 ? 'Good' : s >= 60 ? 'Satisfactory' : 'Needs improvement'; }
function trendLabel(t) { return t === 'IMPROVING' ? 'Improving' : t === 'DECLINING' ? 'Declining' : 'Stable'; }
function volatilityLabel(v) { return v < 3 ? 'Steady' : v < 8 ? 'Variable' : 'Inconsistent'; }
function readinessLabel(r) {
  return r === 'READY' ? 'Ready to progress / consolidate'
    : r === 'RECOVERING' ? 'Recovering - keep current plan'
    : r === 'REMEDIAL' ? 'Remedial focus needed'
    : 'Insufficient data for a confident verdict';
}

function fmtDate(sec) {
  if (!sec) return '-';
  const d = new Date(sec * 1000);
  return d.toISOString().slice(0, 10);
}

function buildPerformance(student, evals) {
  const sorted = evals.slice().sort((a, b) => (a.date || 0) - (b.date || 0));
  const overallScore = sorted.length ? avg(sorted.map(e => e.finalGrade)) : 0;
  const grades = sorted.map(e => e.finalGrade);
  const volatility = grades.length >= 2 ? stddev(grades) : 0;
  const trend = computeTrend(sorted);

  // weighted per-maneuver averages + required map
  const sums = {}, weights = {}, requiredMap = {};
  sorted.forEach(ev => (ev.maneuverGrades || []).forEach(m => {
    const w = Math.max(m.factor, 0.01);
    sums[m.name] = (sums[m.name] || 0) + m.studentGrade * w;
    weights[m.name] = (weights[m.name] || 0) + w;
    if (m.requiredMif > 0) requiredMap[m.name] = m.requiredMif;
  }));
  const practicalScores = {};
  Object.keys(sums).forEach(n => { practicalScores[n] = sums[n] / (weights[n] || 1); });

  // per-maneuver trend
  const series = {};
  sorted.forEach(ev => (ev.maneuverGrades || []).forEach(m => {
    (series[m.name] = series[m.name] || []).push([ev.date || 0, m.studentGrade]);
  }));
  const maneuverTrends = {};
  Object.keys(series).forEach(n => {
    const by = series[n].slice().sort((a, b) => a[0] - b[0]);
    maneuverTrends[n] = by.length < 2 ? 'FLAT' : maneuverTrendOf(by);
  });

  const weakManeuvers = Object.keys(practicalScores).map(n => {
    const req = requiredMap[n] || 70;
    return { name: n, avgGrade: practicalScores[n], requiredMif: req, belowRequired: practicalScores[n] < req, trend: maneuverTrends[n] };
  }).filter(w => w.avgGrade < w.requiredMif).sort((a, b) => a.avgGrade - b.avgGrade);

  const phaseScores = {};
  sorted.forEach(ev => {
    if (!phaseScores[ev.phaseName]) phaseScores[ev.phaseName] = [];
    phaseScores[ev.phaseName].push(ev.finalGrade);
  });
  Object.keys(phaseScores).forEach(p => { phaseScores[p] = avg(phaseScores[p]); });

  const bestManeuver = maxKey(practicalScores);
  const worstManeuver = minKey(practicalScores);
  const overallMifStatus = (sorted.find(e => e.overallMifStatus) || {}).overallMifStatus || '';
  const instructorNotes = sorted.map(e => e.tripNotes).filter(n => n && n.trim());
  const noteThemes = extractThemes(instructorNotes);

  let readiness;
  if (sorted.length < 2) readiness = 'INSUFFICIENT_DATA';
  else if (weakManeuvers.length && trend.t === 'DECLINING') readiness = 'REMEDIAL';
  else if (weakManeuvers.length) readiness = 'RECOVERING';
  else if (volatility > 8) readiness = 'REMEDIAL';
  else readiness = 'READY';

  const firstDate = sorted.length ? sorted[0].date : 0;
  const lastDate = sorted.length ? sorted[sorted.length - 1].date : 0;

  return {
    studentName: student.name,
    overallScore, trend: trend.t, trendDelta: trend.d, volatility,
    practicalScores, weakManeuvers, maneuverTrends, phaseScores,
    bestManeuver, worstManeuver, overallMifStatus,
    instructorNotes, noteThemes, readiness,
    tripCount: sorted.length,
    firstDateLabel: fmtDate(firstDate), lastDateLabel: fmtDate(lastDate),
    spanDays: sorted.length ? Math.floor((lastDate - firstDate) / 86400) : 0,
    evaluationCount: sorted.length
  };
}

function generateFeedback(data) {
  if (!data.evaluationCount) {
    return 'No evaluations found for ' + (data.studentName || 'this student') + '.\nOpen a student profile from a completed trip to generate feedback.';
  }
  const L = [];
  const name = data.studentName || 'the cadet';
  L.push('AI Performance Analysis - ' + name);
  L.push(data.evaluationCount + ' trip(s) | ' + data.firstDateLabel + ' -> ' + data.lastDateLabel);
  if (data.spanDays > 0) L.push('  ~' + (data.tripCount / Math.max(data.spanDays / 30, 1)).toFixed(1) + ' trips/mo');
  L.push('');

  L.push('OVERALL: ' + overallLabel(data.overallScore) + ' (avg ' + data.overallScore.toFixed(1) + ')');
  L.push('Trend: ' + trendLabel(data.trend) + (data.evaluationCount >= 2 ? ' (' + Math.abs(data.trendDelta).toFixed(1) + ' pts ' + (data.trendDelta >= 0 ? 'up' : 'down') + ')' : ''));
  L.push('Consistency: ' + volatilityLabel(data.volatility) + ' (std ' + data.volatility.toFixed(1) + ')');
  if (data.overallMifStatus) L.push('MIF status: ' + data.overallMifStatus);
  L.push('');

  if (data.bestManeuver && (data.practicalScores[data.bestManeuver] || 0) >= 70)
    L.push('STRENGTH: ' + data.bestManeuver + ' (avg ' + data.practicalScores[data.bestManeuver].toFixed(1) + ')');
  L.push('');

  if (data.weakManeuvers.length) {
    L.push('PRIORITY TO IMPROVE:');
    data.weakManeuvers.slice(0, 5).forEach(w => {
      const tag = w.belowRequired ? 'below required MIF ' + w.requiredMif : 'below pass mark';
      const tr = w.trend === 'IMPROVING' ? 'improving' : w.trend === 'DECLINING' ? 'STILL DECLINING' : 'flat';
      L.push('- ' + w.name + ': avg ' + w.avgGrade.toFixed(1) + ' (' + tag + ') - ' + tr);
    });
    L.push('');
  } else if (data.worstManeuver) {
    L.push('Lowest scoring area: ' + data.worstManeuver + ' (avg ' + data.practicalScores[data.worstManeuver].toFixed(1) + ')');
    L.push('');
  }

  if (Object.keys(data.phaseScores).length) {
    L.push('PHASE AVERAGES:');
    Object.keys(data.phaseScores).sort().forEach(p => L.push('- ' + p + ': ' + data.phaseScores[p].toFixed(1)));
    L.push('');
  }

  if (data.noteThemes.length) L.push('RECURRING COACH THEMES: ' + data.noteThemes.join(', '));
  L.push('');

  L.push('READINESS: ' + readinessLabel(data.readiness));
  L.push('');

  L.push('ACS FRAMEWORK (Knowledge + Risk Mgmt + Skill):');
  if (data.weakManeuvers.length) L.push('- Skill: below standard on ' + data.weakManeuvers[0].name + ' - remediate before advancing.');
  else L.push('- Skill: at/above standard across evaluated maneuvers.');
  if (data.trend === 'DECLINING' || data.volatility > 8) L.push('- Risk Mgmt: unstable performance - brief hazards and personal minimums before the next trip.');
  else L.push('- Risk Mgmt: stable - maintain standard operating routines.');
  if (data.noteThemes.length || data.instructorNotes.some(n => /watch|caution|unsafe/i.test(n))) L.push('- Knowledge: gaps flagged in notes (' + data.noteThemes.slice(0, 3).join(', ') + ').');
  else L.push('- Knowledge: no recurring gaps flagged.');
  L.push('');

  L.push('FOR THE INSTRUCTOR - NEXT TRIP:');
  if (!data.weakManeuvers.length) {
    L.push('- No failing maneuvers against standard. Keep current coaching; introduce advanced scenarios to stretch the cadet.');
  } else {
    const top = data.weakManeuvers[0];
    L.push("- Next trip: demonstrate '" + top.name + "' to standard, then guided practice, then solo - do not advance until consistently at " + top.requiredMif + '+.');
    L.push('- Give cockpit attention to: ' + data.weakManeuvers.slice(0, 3).map(w => w.name).join(', ') + '.');
    const declining = data.weakManeuvers.filter(w => w.trend === 'DECLINING');
    if (declining.length) L.push("- " + declining[0].name + ' is still declining: change the teaching technique (demonstrate the correct feel), not just more repetition.');
    if (data.trend === 'DECLINING') L.push('- Trend is down. Run a standardisation/recurrency check before progressing phases; remediate the weak fundamental first.');
    else if (data.trend === 'IMPROVING') L.push('- Momentum is good. Let the cadet lead more; reduce instructor inputs on strengths to build airmanship.');
    if (data.volatility > 8) L.push('- Grades are inconsistent (high variance). Focus on repeatability and "feel of the airplane" before advancing.');
    if (data.instructorNotes.some(n => /watch|caution|unsafe/i.test(n))) L.push('- Prioritise the safety items flagged in previous notes before adding new tasks.');
    L.push('- After each sortie, review with the cadet using ADM: what happened, why, and the correction.');
    if (data.volatility > 8 || data.trend === 'DECLINING' || data.instructorNotes.some(n => /watch|caution|unsafe/i.test(n)))
      L.push('- Run a PAVE brief (Pilot, Aircraft, EnVironment, External) before the next trip; set personal minimums for the weak area.');
  }
  L.push('');

  L.push('TRAINING PLAN - WHAT THE CADET SHOULD DO:');
  if (!data.weakManeuvers.length) {
    L.push('- Maintain current rhythm. Practise variations of strong maneuvers to build consistency and airmanship.');
  } else {
    data.weakManeuvers.slice(0, 3).forEach(w => L.push("- Drill '" + w.name + "' (avg " + w.avgGrade.toFixed(1) + '): chair-fly + repeat to standard until steady at ' + w.requiredMif + '+.'));
    L.push('- Use simulator / chair-flying for the weakest item(s) before the next flight.');
    if (data.trend === 'DECLINING') L.push('- Slow the pace: consolidate the fundamentals rather than advancing to new material.');
    else if (data.trend === 'IMPROVING') L.push('- Keep the current study cadence; it is paying off.');
    if (data.noteThemes.length) L.push('- Re-study ground theory for: ' + data.noteThemes.slice(0, 3).join(', ') + ' (flagged in instructor notes).');
    L.push('- Self-grade each session against the required MIF and log what improved.');
  }
  L.push('');
  L.push('METHOD (FAA AIH / CFI ACS / Risk Mgmt Hbk): demonstrate, then guided practice, then solo.');
  L.push('Grade against ACS (Knowledge + Risk Mgmt + Skill); remediate weak fundamentals before advancing.');
  return L.join('\n');
}

/* ---- small stats helpers ------------------------------------------------ */
function avg(a) { return a.reduce((s, x) => s + x, 0) / a.length; }
function stddev(a) {
  const m = avg(a);
  return Math.sqrt(a.map(x => (x - m) * (x - m)).reduce((s, x) => s + x, 0) / a.length);
}
function computeTrend(sorted) {
  if (sorted.length < 2) return { t: 'STABLE', d: 0 };
  const half = Math.floor(sorted.length / 2);
  const first = avg(sorted.slice(0, half).map(e => e.finalGrade));
  const second = avg(sorted.slice(half).map(e => e.finalGrade));
  const d = second - first;
  return d >= 3 ? { t: 'IMPROVING', d } : d <= -3 ? { t: 'DECLINING', d } : { t: 'STABLE', d };
}
function maneuverTrendOf(by) {
  const half = Math.floor(by.length / 2);
  const first = avg(by.slice(0, half).map(p => p[1]));
  const second = avg(by.slice(half).map(p => p[1]));
  const d = second - first;
  return d >= 5 ? 'IMPROVING' : d <= -5 ? 'DECLINING' : 'FLAT';
}
function maxKey(o) { let bk = null, bv = -Infinity; Object.keys(o).forEach(k => { if (o[k] > bv) { bv = o[k]; bk = k; } }); return bk; }
function minKey(o) { let bk = null, bv = Infinity; Object.keys(o).forEach(k => { if (o[k] < bv) { bv = o[k]; bk = k; } }); return bk; }
function extractThemes(notes) {
  const counts = {};
  notes.forEach(n => n.toLowerCase().split(/[^a-z]+/).forEach(w => {
    if (w.length >= 4 && !STOP_WORDS.has(w)) counts[w] = (counts[w] || 0) + 1;
  }));
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 5);
}
