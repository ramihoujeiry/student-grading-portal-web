#!/usr/bin/env node
// Robust Core Web Vitals runner for task t_8e5ad8e5.
//
// Why this exists: the reusable run-mobile.js shells out via execFileSync and
// hangs on Chrome teardown (TARGET_CRASHED on insight audits -> ChromeLauncher
// stuck killing the instance -> 10-min timeout per run). On this box the
// throttled Chrome tab also intermittently crashes during gather, which leaves
// a JSON with null/errored core metrics.
//
// This runner:
//   1. Spawns the Lighthouse CLI as a child process with a HARD timeout that
//      SIGKILLs it. The Lighthouse JSON is flushed to disk BEFORE the teardown
//      hang, so killing the hung teardown leaves a complete, valid file.
//   2. Validates that the core CWV metrics (LCP/FCP/CLS/TTI) are present and
//      not errored. Crashed runs are discarded and retried.
//   3. Collects 3 VALID runs per network (wifi/4g/3g), capped at MAX_ATTEMPTS
//      to avoid an infinite loop, then records the median.
//
// Usage: node cwv-runner.js [--network=all|wifi|4g|3g] [--runs=3]
// Raw per-run JSON: raw-data/cwv-<net>-<ts>-<attempt>.json
// Aggregate:        reports/cwv-results-<ts>.json

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const WORKSPACE = path.resolve(__dirname, '..');
const RAW = path.join(WORKSPACE, 'raw-data');
const REPORTS = path.join(WORKSPACE, 'reports');
const CLI = 'C:\\Users\\USER\\AppData\\Local\\hermes\\kanban\\workspaces\\t_21c6a2b7\\tools\\node_modules\\lighthouse\\cli\\index.js';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'https://ramihoujeiry.github.io/student-grading-portal-web/';

const RUN_TIMEOUT_MS = 280000; // hard cap; JSON is written well before teardown hang
const MAX_ATTEMPTS = 9;        // per network, to collect 3 valid runs

const args = process.argv.slice(2);
const getArg = (n, d) => { const a = args.find(x => x.startsWith('--' + n + '=')); return a ? a.split('=')[1] : d; };
const NETWORK_SEL = getArg('network', 'all');
const RUNS = parseInt(getArg('runs', '3'), 10);

const NETWORKS = {
  wifi: ['--throttling-method=provided'],
  '4g': [],
  '3g': ['--throttling.rttMs=400', '--throttling.throughputKbps=400', '--throttling.requestLatencyMs=400'],
};

const SCREEN = [
  '--form-factor=mobile',
  '--screenEmulation.mobile=true',
  '--screenEmulation.width=360',
  '--screenEmulation.height=640',
  '--screenEmulation.deviceScaleFactor=3',
  '--emulated-user-agent=Mozilla/5.0 (Linux; Android 12; Moto G Power) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36',
];

const AUDITS = {
  'performance-score': (r) => Math.round((r.categories.performance.score || 0) * 100),
  'first-contentful-paint': (r) => r.audits['first-contentful-paint'].numericValue,
  'largest-contentful-paint': (r) => r.audits['largest-contentful-paint'].numericValue,
  'total-blocking-time': (r) => r.audits['total-blocking-time'].numericValue,
  'speed-index': (r) => r.audits['speed-index'].numericValue,
  'cumulative-layout-shift': (r) => r.audits['cumulative-layout-shift'].numericValue,
  'time-to-interactive': (r) => r.audits['interactive'].numericValue,
  'max-potential-fid': (r) => r.audits['max-potential-fid'].numericValue,
  'server-response-time': (r) => (r.audits['server-response-time'] ? r.audits['server-response-time'].numericValue : null),
};

const median = (arr) => {
  const s = [...arr].filter(x => x != null).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function runOnceCli(outPath, extraFlags) {
  return new Promise((resolve) => {
    const cmd = [
      CLI, URL,
      '--only-categories=performance',
      '--output=json',
      '--output-path=' + outPath,
      '--chrome-flags=--no-sandbox --disable-gpu --disable-dev-shm-usage',
      ...SCREEN,
      ...extraFlags,
      '--chrome-path=' + CHROME,
    ];
    const child = spawn('node', cmd, { stdio: 'ignore' });
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      // The Lighthouse JSON is fully flushed to disk before the Chrome
      // teardown that hangs on this box. Kill the child now to skip the
      // multi-minute teardown hang once results are captured.
      try { child.kill('SIGKILL'); } catch (e) {}
      resolve();
    };
    // Safety cap; normally we finish early once a valid JSON is written.
    const timer = setTimeout(finish, RUN_TIMEOUT_MS);
    // Poll for a complete, valid result file instead of waiting on teardown.
    const poll = setInterval(() => {
      if (done) { clearInterval(poll); return; }
      if (!fs.existsSync(outPath)) return;
      try {
        const lhr = JSON.parse(fs.readFileSync(outPath, 'utf8'));
        if (lhr && lhr.audits && lhr.categories && validMetrics(lhr)) {
          clearInterval(poll);
          finish();
        }
      } catch (e) { /* not flushed yet */ }
    }, 4000);
    child.on('close', finish);
    child.on('error', finish);
  });
}

function validMetrics(lhr) {
  try {
    const a = lhr.audits;
    const core = ['largest-contentful-paint', 'first-contentful-paint', 'cumulative-layout-shift', 'interactive'];
    return core.every(k => a[k] && a[k].numericValue != null && !a[k].errorMessage);
  } catch (e) { return false; }
}

async function runNetwork(net) {
  const runs = [];
  let attempts = 0;
  while (runs.length < RUNS && attempts < MAX_ATTEMPTS) {
    attempts++;
    const outPath = path.join(RAW, `cwv-${net}-${Date.now()}-${attempts}.json`);
    process.stdout.write(`  [${net}] attempt ${attempts} ... `);
    await runOnceCli(outPath, NETWORKS[net]);
    if (!fs.existsSync(outPath)) { console.log('no file produced'); continue; }
    let lhr;
    try { lhr = JSON.parse(fs.readFileSync(outPath, 'utf8')); }
    catch (e) { fs.unlinkSync(outPath); console.log('unreadable json'); continue; }
    if (!validMetrics(lhr)) {
      const err = (lhr.audits['largest-contentful-paint'] || {}).errorMessage || 'crashed';
      console.log('INVALID (' + err + ') -> discard');
      fs.unlinkSync(outPath);
      continue;
    }
    const row = {};
    for (const [k, fn] of Object.entries(AUDITS)) { try { row[k] = fn(lhr); } catch (e) { row[k] = null; } }
    runs.push(row);
    console.log(`OK LCP=${Math.round(row['largest-contentful-paint'])}ms perf=${row['performance-score']}`);
  }
  if (!runs.length) { console.log(`  [${net}] NO VALID RUNS (all ${attempts} attempts crashed)`); return null; }
  const agg = {};
  for (const k of Object.keys(AUDITS)) agg[k] = median(runs.map(r => r[k]));
  return { network: net, runCount: runs.length, attempts, runs, median: agg };
}

(async () => {
  fs.mkdirSync(RAW, { recursive: true });
  fs.mkdirSync(REPORTS, { recursive: true });
  const nets = NETWORK_SEL === 'all' ? Object.keys(NETWORKS) : [NETWORK_SEL];
  const results = [];
  for (const net of nets) {
    console.log(`\n=== Network: ${net} (target ${RUNS} valid runs, max ${MAX_ATTEMPTS} attempts) ===`);
    const r = await runNetwork(net);
    if (r) results.push(r);
  }
  const out = { url: URL, generatedAt: new Date().toISOString(), runsPerNetwork: RUNS, maxAttempts: MAX_ATTEMPTS, results };
  const outPath = path.join(REPORTS, `cwv-results-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log('\n=== MEDIAN SUMMARY (Core Web Vitals) ===');
  for (const r of results) {
    console.log(`\n[${r.network}] (${r.runCount} valid / ${r.attempts} attempts)`);
    for (const [k, v] of Object.entries(r.median)) {
      const unit = (k === 'cumulative-layout-shift' || k === 'performance-score') ? '' : ' ms';
      console.log(`  ${k}: ${v == null ? 'n/a' : Math.round(v) + unit}`);
    }
  }
  console.log(`\nAggregate saved: ${outPath}`);
})().catch(e => { console.error('CWV RUNNER FAILED:', e); process.exit(1); });
