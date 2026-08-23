// UI cross-browser / cross-device test harness for the Student Grading Portal web app.
// Drives the REAL bundled Vue app (Vite dev server) in real Chrome + Edge, injects a
// realistic admin dataset into the Vue instance (no Firebase calls), exercises every
// tab + the key modals, measures horizontal overflow across viewports, and runs axe-core.
//
// Robustness notes:
//  - One browser instance per engine, reused across viewports (fresh context per viewport).
//  - Incremental progress written to progress.log so we have visibility mid-run.
//  - axe-core injected per page load (cache cleared per context anyway).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const WORK = 'C:/Users/USER/AppData/Local/hermes/kanban/workspaces/t_90a8ab51/test';
const SHOTS = path.join(WORK, 'shots');
const APP_URL = 'http://[::1]:5173/student-grading-portal-web/';
const AXE = path.join(WORK, 'axe.min.js');
fs.mkdirSync(SHOTS, { recursive: true });

const LOG = path.join(WORK, 'progress.log');
fs.writeFileSync(LOG, '');
const plog = (s) => { fs.appendFileSync(LOG, s + '\n'); };

const BROWSERS = [
  { name: 'chrome', exe: 'C:/Program Files/Google/Chrome/Application/chrome.exe' },
  { name: 'edge',   exe: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' },
];

const VIEWPORTS = [
  { w: 320, h: 640, tag: '320' },
  { w: 360, h: 740, tag: '360' },
  { w: 375, h: 812, tag: '375' },
  { w: 414, h: 896, tag: '414' },
  { w: 768, h: 1024, tag: '768' },
  { w: 820, h: 1180, tag: '820' },
  { w: 1024, h: 768, tag: '1024' },
  { w: 1280, h: 800, tag: '1280' },
  { w: 1440, h: 900, tag: '1440' },
];
const EDGE_VIEWPORTS = ['320', '768', '1280'];
const TABS = ['dashboard', 'students', 'instructors', 'aircraft', 'mif', 'evaluations',
  'announcements', 'analytics', 'admin', 'ai', 'ask'];
const AXE_TABS = ['dashboard', 'evaluations', 'analytics', 'students', 'mif'];

function sampleData() {
  const AY = '2026-2027';
  const students = [
    { id: 's1', name: 'Cadet Alpha', active: true, activeYears: [AY] },
    { id: 's2', name: 'Cadet Bravo', active: true, activeYears: [AY] },
    { id: 's3', name: 'Cadet Charlie', active: false, activeYears: [AY] },
  ];
  const instructors = [{ id: 'i1', name: 'Instr Delta', active: true }, { id: 'i2', name: 'Instr Echo', active: true }];
  const aircraft = [{ id: 'a1', name: 'R44-2' }, { id: 'a2', name: 'R44' }];
  const mifTables = [{
    id: 'm1', aircraftType: 'R44-2', phaseName: 'CONTACT', stages: ['S1', 'S2', 'S3'],
    maneuvers: [
      { name: 'Preflight', factor: 1.0, stageMifs: { S1: 2, S2: 3, S3: 4 } },
      { name: 'Hover', factor: 1.5, stageMifs: { S1: 2, S2: 3, S3: 4 } },
      { name: 'Takeoff', factor: 1.0, stageMifs: { S1: 2, S2: 3, S3: 4 } },
      { name: 'Traffic Pattern', factor: 1.2, stageMifs: { S1: 2, S2: 3, S3: 4 } },
      { name: 'Autorotation', factor: 2.0, stageMifs: { S1: 2, S2: 3, S3: 4 } },
      { name: 'Confined Area', factor: 1.8, stageMifs: { S1: 2, S2: 3, S3: 4 } },
      { name: 'Emergency Procedures', factor: 1.5, stageMifs: { S1: 2, S2: 3, S3: 4 } },
      { name: 'Postflight', factor: 0.8, stageMifs: { S1: 2, S2: 3, S3: 4 } },
    ],
  }];
  const base = Date.parse('2026-01-10') / 1000;
  const mk = (id, studentId, studentName, dateOff, grades, note) => ({
    id, studentId, studentName, instructorName: 'Instr Delta', aircraftType: 'R44-2',
    phaseName: 'CONTACT', tripNumber: 'T' + (dateOff + 1), flightYear: AY,
    date: base + dateOff * 86400, duration: '1.5', finalGrade: null, overallMifStatus: '',
    tripNotes: note || '', maneuverGrades: grades,
  });
  const g = (name, grade, req, factor) => ({ name, studentGrade: grade, requiredMif: req, factor });
  const evals = [
    mk('e1', 's1', 'Cadet Alpha', 0, [g('Preflight',4,2,1),g('Hover',3,3,1.5),g('Takeoff',4,2,1),g('Traffic Pattern',3,2,1.2),g('Autorotation',3,2,2),g('Confined Area',2,2,1.8),g('Emergency Procedures',4,2,1.5),g('Postflight',4,2,0.8)], 'Watch nose attitude in the hover.'),
    mk('e2', 's1', 'Cadet Alpha', 20, [g('Preflight',4,2,1),g('Hover',4,3,1.5),g('Takeoff',4,2,1),g('Traffic Pattern',4,2,1.2),g('Autorotation',3,2,2),g('Confined Area',3,2,1.8),g('Emergency Procedures',4,2,1.5),g('Postflight',4,2,0.8)]),
    mk('e3', 's2', 'Cadet Bravo', 5, [g('Preflight',2,2,1),g('Hover',2,3,1.5),g('Takeoff',3,2,1),g('Traffic Pattern',2,2,1.2),g('Autorotation',2,2,2),g('Confined Area',1,2,1.8),g('Emergency Procedures',2,2,1.5),g('Postflight',3,2,0.8)], 'Caution on confined-area approach.'),
    mk('e4', 's2', 'Cadet Bravo', 30, [g('Preflight',3,2,1),g('Hover',3,3,1.5),g('Takeoff',3,2,1),g('Traffic Pattern',3,2,1.2),g('Autorotation',2,2,2),g('Confined Area',2,2,1.8),g('Emergency Procedures',3,2,1.5),g('Postflight',3,2,0.8)]),
    mk('e5', 's1', 'Cadet Alpha', 45, [g('Preflight',4,2,1),g('Hover',2,3,1.5),g('Takeoff',4,2,1),g('Traffic Pattern',4,2,1.2),g('Autorotation',4,2,2),g('Confined Area',4,2,1.8),g('Emergency Procedures',4,2,1.5),g('Postflight',4,2,0.8)]),
    mk('e6', 's3', 'Cadet Charlie', 10, [g('Preflight',3,2,1),g('Hover',3,3,1.5),g('Takeoff',3,2,1),g('Traffic Pattern',3,2,1.2),g('Autorotation',3,2,2),g('Confined Area',3,2,1.8),g('Emergency Procedures',3,2,1.5),g('Postflight',3,2,0.8)]),
  ];
  evals.forEach(e => {
    const graded = e.maneuverGrades.filter(m => m.studentGrade != null && m.studentGrade !== 0);
    const fg = graded.length ? graded.reduce((s, m) => s + m.studentGrade, 0) / graded.length : null;
    e.finalGrade = fg == null ? null : Math.round(fg * 10) / 10;
    const fail = e.maneuverGrades.filter(m => m.studentGrade != null && m.studentGrade !== 0 && m.requiredMif != null && m.studentGrade < m.requiredMif).length;
    e.overallMifStatus = fail >= 2 ? 'BELOW_STANDARD' : 'MEETS_STANDARD';
  });
  const announcements = [
    { id: 'an1', title: 'Phase Check', message: 'Contact phase checks next Tuesday.', targetRole: 'all', senderName: 'Instr Delta', timestamp: base + 1000 },
    { id: 'an2', title: 'Aircraft Down', message: 'R44 grounded for inspection.', targetRole: 'instructor', senderName: 'Instr Echo', timestamp: base + 500 },
  ];
  const users = [
    { id: 'u1', name: 'Admin One', email: 'admin@x', role: 'admin' },
    { id: 'u2', name: 'Instr Delta', email: 'd@x', role: 'instructor' },
    { id: 'u3', name: 'Pending Pat', email: 'p@x', role: 'pending' },
  ];
  return { AY, students, instructors, aircraft, mifTables, evals, announcements, users };
}

async function injectData(page) {
  await page.evaluate((data) => {
    const vm = document.querySelector('#app').__vue_app__._instance.proxy;
    vm.user = { uid: 'me', email: 'tester@x', emailVerified: true };
    vm.role = 'admin';
    vm.students = data.students; vm.instructors = data.instructors; vm.aircraft = data.aircraft;
    vm.mifTables = data.mifTables; vm.evaluations = data.evals; vm.announcements = data.announcements;
    vm.users = data.users; vm.activeYear = data.AY; vm.years = [data.AY]; vm.aiBadge = 'offline'; vm.fbReady = true;
  }, sampleData());
}

async function measureOverflow(page) {
  return await page.evaluate(() => {
    const docW = document.documentElement.clientWidth;
    let docScroll = Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth);
    let maxRight = 0, culprit = null;
    const els = document.querySelectorAll('body *');
    for (const el of els) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > maxRight) { maxRight = r.right; culprit = el; }
    }
    return {
      docScroll, overflowX: Math.max(0, maxRight - docW), vpW: docW,
      culprit: culprit ? (culprit.tagName + (culprit.className ? '.' + String(culprit.className).split(' ').slice(0, 2).join('.') : '')) : null,
      culpritRight: Math.round(maxRight),
    };
  });
}

async function runAxe(page) {
  await page.addScriptTag({ path: AXE });
  return await page.evaluate(async () => {
    if (!window.axe) return { error: 'axe not loaded' };
    const r = await window.axe.run(document, { resultTypes: ['violations'] });
    return { violations: r.violations.map(v => ({ id: v.id, impact: v.impact, count: v.nodes.length,
      nodes: v.nodes.slice(0, 4).map(n => ({ target: n.target, failureSummary: n.failureSummary })) })) };
  });
}

const allRows = [];
const report = { browsers: {}, generatedAt: new Date().toISOString() };

for (const b of BROWSERS) {
  const vps = VIEWPORTS.filter(v => b.name !== 'edge' || EDGE_VIEWPORTS.includes(v.tag));
  plog(`### ${b.name}: ${vps.map(v => v.tag).join(', ')}`);
  let browser;
  try {
    browser = await chromium.launch({ executablePath: b.exe, headless: true,
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
  } catch (e) { plog(`!! ${b.name} launch failed: ${e.message}`); continue; }
  const rows = [];
  try {
    for (const vp of vps) {
      plog(`-- ${b.name} ${vp.tag} start`);
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      const errs = [];
      page.on('pageerror', e => errs.push('pageerror: ' + (e.message || e)));
      page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
      try {
        await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForFunction(() => document.querySelector('#app') && document.querySelector('#app').__vue_app__, null, { timeout: 30000 });
        await page.waitForTimeout(250);

        // AUTH screen
        let ov = await measureOverflow(page);
        rows.push({ vp: vp.tag, tab: 'auth', ...ov });
        await page.screenshot({ path: path.join(SHOTS, `${b.name}-${vp.tag}-auth.png`) });

        // logged-in admin shell
        await injectData(page);
        await page.waitForTimeout(250);
        for (const tab of TABS) {
          await page.evaluate(t => { document.querySelector('#app').__vue_app__._instance.proxy.setTab(t); }, tab);
          await page.waitForTimeout(200);
          ov = await measureOverflow(page);
          rows.push({ vp: vp.tag, tab, ...ov });
          if (tab === 'dashboard') await page.screenshot({ path: path.join(SHOTS, `${b.name}-${vp.tag}-dashboard.png`) });
          if (AXE_TABS.includes(tab)) {
            const axe = await runAxe(page);
            if (axe.error) rows.push({ vp: vp.tag, tab, axeError: axe.error });
            else if (axe.violations.length) rows.push({ vp: vp.tag, tab, axeViolations: axe.violations.length, axeDetail: axe.violations });
          }
        }

        // New Evaluation modal
        await page.evaluate(() => {
          const vm = document.querySelector('#app').__vue_app__._instance.proxy;
          vm.evalForm = { studentId: 's1', aircraftType: 'R44-2', phaseName: 'CONTACT', flightYear: vm.activeYear, maneuverGrades: [], duration: '01:00' };
          vm.durationH = '01'; vm.durationM = '00'; vm.showEvalModal = true;
          vm.$nextTick(() => { try { vm.loadManeuversForForm(); } catch (e) {} });
        });
        await page.waitForTimeout(500);
        ov = await measureOverflow(page);
        rows.push({ vp: vp.tag, tab: 'modal-new-eval', ...ov });
        await page.screenshot({ path: path.join(SHOTS, `${b.name}-${vp.tag}-modal-new-eval.png`) });
        const axeModal = await runAxe(page);
        if (!axeModal.error && axeModal.violations.length) rows.push({ vp: vp.tag, tab: 'modal-new-eval', axeViolations: axeModal.violations.length, axeDetail: axeModal.violations });

        // Student profile modal
        await page.evaluate(() => { const vm = document.querySelector('#app').__vue_app__._instance.proxy; vm.showEvalModal = false; vm.selectedStudent = vm.students[0]; });
        await page.waitForTimeout(300);
        ov = await measureOverflow(page);
        rows.push({ vp: vp.tag, tab: 'modal-student', ...ov });

        // light theme dashboard
        await page.evaluate(() => { const vm = document.querySelector('#app').__vue_app__._instance.proxy; vm.selectedStudent = null; vm.setTab('dashboard'); vm.theme = 'light'; });
        await page.waitForTimeout(200);
        ov = await measureOverflow(page);
        rows.push({ vp: vp.tag, tab: 'dashboard-light', ...ov });
        await page.screenshot({ path: path.join(SHOTS, `${b.name}-${vp.tag}-dashboard-light.png`) });

        if (errs.length) rows.push({ vp: vp.tag, errors: errs });
      } catch (e) {
        plog(`!! ${b.name} ${vp.tag} error: ${e.message}`);
        rows.push({ vp: vp.tag, fatal: e.message });
      } finally {
        await ctx.close();
      }
      plog(`-- ${b.name} ${vp.tag} done (rows=${rows.length})`);
    }
  } finally {
    await browser.close();
  }
  report.browsers[b.name] = { rows };
  allRows.push(...rows.map(r => ({ browser: b.name, ...r })));
  fs.writeFileSync(path.join(WORK, `report-${b.name}.json`), JSON.stringify(rows, null, 2));
}

const problems = allRows.filter(r => (r.overflowX > 1 || r.docScroll > 1) && r.tab);
const axeProblems = allRows.filter(r => r.axeViolations > 0);
const pageErrors = allRows.filter(r => r.errors);
const fatal = allRows.filter(r => r.fatal);

const summary = [
  '=== SUMMARY ===',
  `Total measurements: ${allRows.filter(r => r.tab).length}`,
  `Overflow problems (>1px): ${problems.length}`,
  ...problems.map(p => `  [${p.browser}] ${p.vp} ${p.tab}: overflowX=${p.overflowX} docScroll=${p.docScroll} culprit=${p.culprit}`),
  `Axe violations: ${axeProblems.reduce((s, r) => s + r.axeViolations, 0)} across ${axeProblems.length} cells`,
  ...axeProblems.flatMap(p => p.axeDetail.map(d => `  [${p.browser}] ${p.vp} ${p.tab}: ${d.id} (${d.impact}) x${d.count}`)),
  `Page errors: ${pageErrors.length}`,
  ...pageErrors.slice(0, 20).flatMap(p => p.errors.map(e => `  [${p.browser}] ${p.vp}: ${e}`)),
  `Fatal cells: ${fatal.length}`,
  ...fatal.map(f => `  [${f.browser}] ${f.vp}: ${f.fatal}`),
];
fs.writeFileSync(path.join(WORK, 'report-all.json'), JSON.stringify(allRows, null, 2));
fs.writeFileSync(path.join(WORK, 'summary.txt'), summary.join('\n'));
plog('\n' + summary.join('\n'));
console.log(summary.join('\n'));
