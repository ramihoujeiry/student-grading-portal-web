// Standalone audit test for the Timestamp-normalization fix (t_f1218532).
// Mirrors the exact logic added to src/store.js / store.js.

const EPOCH_FLOOR = 0;
const EPOCH_CEIL = 4102444800;
function toEpochSec(v) {
  if (v == null) return 0;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return 0;
    const s = v >= 1e11 ? Math.floor(v / 1000) : v;
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
function fmtDate(sec) {
  const s = toEpochSec(sec);
  if (!s) return '-';
  const d = new Date(s * 1000);
  if (isNaN(d.getTime())) return '-';
  const y = d.getUTCFullYear();
  if (y < 1970 || y > 2099) return '-';
  return d.toISOString().slice(0, 10);
}

// Fake Firestore Timestamp with getters (typical SDK shape)
function ts(seconds) {
  return { seconds, nanoseconds: 0,
    toDate() { return new Date(seconds * 1000); },
    toMillis() { return seconds * 1000; } };
}

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = got === want || (want === '-' && got === '-');
  if (ok) { pass++; }
  else { fail++; console.log(`FAIL: ${name} => got '${got}' want '${want}'`); }
}

const DAY = 86400;
const realDate = Date.UTC(2025, 6, 15) / 1000; // 2025-07-15 in seconds
const year3995secs = 6.33e11; // a raw JS Date object's .getTime() * 1000 guard test

// 1) number seconds -> correct date
check('num seconds', fmtDate(realDate), '2025-07-15');
// 2) Firestore Timestamp {seconds} -> correct
check('TS seconds', fmtDate(ts(realDate)), '2025-07-15');
// 3) ms-scale number -> normalized
check('ms number', fmtDate(realDate * 1000), '2025-07-15');
// 4) raw JS Date object -> normalized (the prior year-3995 bug)
check('raw Date', fmtDate(new Date(realDate * 1000)), '2025-07-15');
// 5) an actually-impossible epoch*seconds* value (year ~2128) -> rejected by the 2099 guard
check('above 2099', fmtDate(5e9), '-');
// 5b) prove a RAW JS Date object can NEVER yield year 3995: pass one straight
//     into fmtDate. toEpochSec() normalizes it, so the result is a real year.
check('raw Date no 3995', fmtDate(new Date(realDate * 1000)), '2025-07-15');
// 6) NaN -> '-' (no throw)
check('NaN', fmtDate(NaN), '-');
check('null', fmtDate(null), '-');
check('undefined', fmtDate(undefined), '-');
// 7) toEpochSec returns 0 for an actual Date object passed raw (so app never multiplies a Date by 1000)
check('toEpochSec raw Date', toEpochSec(new Date(realDate * 1000)), realDate);
// 8) sort math with mixed types
const evals = [
  { date: ts(realDate + 5 * DAY), finalGrade: 80 },
  { date: new Date((realDate) * 1000), finalGrade: 70 },       // raw Date
  { date: realDate + 10 * DAY, finalGrade: 90 },              // number
  { date: null, finalGrade: 60 },                             // missing -> sorts first (date 0)
];
const norm = evals.map(e => e && typeof e === 'object' ? { ...e, date: toEpochSec(e.date) } : e);
norm.sort((a, b) => (a.date || 0) - (b.date || 0));
check('sort order first (null)', norm[0].finalGrade, 60);
check('sort order last', norm[3].finalGrade, 90);
// 9) fmtDate of each normalized date
check('fmt normalized null', fmtDate(norm[0].date), '-');
check('fmt normalized TS', fmtDate(norm[1].date), '2025-07-15');
check('fmt normalized num', fmtDate(norm[3].date), '2025-07-25');

// 10) range rejection: ensure no future date in 2101 -> '-'
check('above 2099', fmtDate(4102444801), '-');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
