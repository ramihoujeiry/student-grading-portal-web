// Parity tests for the changes that had been deployed on gh-pages but were
// missing from main's source:
//
//  - Student Hours / Progress Analytics / Failed Items / Trip History tabs removed
//  - CSV export writes one column per maneuver (MIF order) instead of a single
//    "name: grade" blob
//  - Analytics resolves evaluations stored with a studentName but no studentId,
//    which used to make those students show "0 trips"
//  - Admin-only Edit button on the evaluation detail modal
//
// Runs against the live-parity fixture (real src/app.js + src/index.html, stubbed
// Firebase) served by tests/serve.mjs.

import { test, expect } from '@playwright/test';

const YEAR = '2026-2027';

async function bootSignedIn(page, role = 'admin') {
  await page.goto('/app.html');
  await page.waitForFunction(() => window.__vm && typeof window.__vm.setTab === 'function', null, { timeout: 30000 });
  await page.evaluate((r) => {
    const vm = window.__vm;
    vm.user = { uid: 'test-user', displayName: 'Test IP', emailVerified: true };
    vm.role = r;
    vm.years = ['2025-2026', '2026-2027'];
    vm.activeYear = '2026-2027';
    vm.students = [
      { id: 's1', name: 'Ihab Abou Ali', active: true },
      { id: 's2', name: 'Jane Roe', active: true },
    ];
    vm.evaluations = [];
  }, role);
}

test('the four tabs that were removed from the deployed build stay removed', async ({ page }) => {
  await bootSignedIn(page);

  const labels = await page.locator('.tab-btn').allInnerTexts();
  // Sanity: the header really rendered, so an empty list can't pass this test.
  expect(labels).toContain('Dashboard');
  expect(labels).toContain('Evaluations');
  for (const gone of ['Student Hours', 'Progress Analytics', 'Failed Items', 'Trip History']) {
    expect(labels, `${gone} tab should not exist`).not.toContain(gone);
  }
});

test('CSV export writes one column per maneuver, in MIF order', async ({ page }) => {
  await bootSignedIn(page);

  const csv = await page.evaluate((year) => {
    const vm = window.__vm;
    vm.evaluations = [
      {
        id: 'e1', studentId: 's1', studentName: 'Ihab Abou Ali', aircraftType: 'R44',
        phaseName: 'CONTACT', tripNumber: 'S1', date: 1755000000, instructorName: 'IP One',
        duration: '01:00', finalGrade: 85, overallMifStatus: 'STANDARD', flightYear: year,
        maneuverGrades: [
          { name: 'Hover', studentGrade: 85 },
          { name: 'Traffic Pattern', studentGrade: 90 },
        ],
      },
      {
        id: 'e2', studentId: 's1', studentName: 'Ihab Abou Ali', aircraftType: 'R44',
        phaseName: 'CONTACT', tripNumber: 'S2', date: 1755100000, instructorName: 'IP One',
        duration: '01:00', finalGrade: 70, overallMifStatus: 'STANDARD', flightYear: year,
        maneuverGrades: [
          { name: 'Hover', studentGrade: 70 },
          { name: 'Autorotation', studentGrade: 60 },
        ],
      },
    ];
    // Capture the Blob instead of letting the browser download a file.
    let captured = null;
    const realCreate = URL.createObjectURL;
    const realRevoke = URL.revokeObjectURL;
    const realClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = (blob) => { captured = blob; return 'blob:test'; };
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = function () {};
    try {
      vm.exportCSV();
    } finally {
      URL.createObjectURL = realCreate;
      URL.revokeObjectURL = realRevoke;
      HTMLAnchorElement.prototype.click = realClick;
    }
    return captured ? captured.text() : Promise.resolve('');
  }, YEAR);

  const lines = csv.trim().split('\r\n');
  // Every cell is quoted by the exporter, headers included.
  const unquote = (cell) => cell.replace(/^"|"$/g, '');
  const header = lines[0].split(',').map(unquote);
  // Maneuvers appear after the fixed columns, in the order first seen across evals.
  expect(header.slice(header.length - 3)).toEqual(['Hover', 'Traffic Pattern', 'Autorotation']);
  expect(header).toContain('TripNotes');
  expect(header).not.toContain('Maneuvers');

  const row = (trip) => lines.find((l) => l.includes(`"${trip}"`)).split(',');
  // Row order is oldest-first after the reverse() in exportCSV: S1 then S2.
  expect(row('S1').slice(-3)).toEqual(['"85"', '"90"', '""']);
  expect(row('S2').slice(-3)).toEqual(['"70"', '""', '"60"']);
});

test('Analytics counts trips whose evaluation has a studentName but no studentId', async ({ page }) => {
  await bootSignedIn(page);

  const rows = await page.evaluate((year) => {
    const vm = window.__vm;
    vm.students = [{ id: 's1', name: 'Ihab Abou Ali', active: true }];
    vm.evaluations = [
      // Imported/legacy doc: no studentId at all.
      { id: 'e1', studentName: 'Ihab Abou Ali', flightYear: year, finalGrade: 80, duration: '01:00', maneuverGrades: [] },
      // Normal doc.
      { id: 'e2', studentId: 's1', studentName: 'Ihab Abou Ali', flightYear: year, finalGrade: 90, duration: '01:00', maneuverGrades: [] },
      // Same student, different school year -> must not be counted.
      { id: 'e3', studentId: 's1', studentName: 'Ihab Abou Ali', flightYear: '2025-2026', finalGrade: 100, duration: '02:00', maneuverGrades: [] },
    ];
    return vm.studentAnalytics;
  }, YEAR);

  const ihab = rows.find((r) => r.name === 'Ihab Abou Ali');
  expect(ihab).toBeTruthy();
  expect(ihab.tripCount).toBe(2);
  expect(ihab.totalHours).toBeCloseTo(2, 5);
});

test('evaluation detail shows an admin-only Edit button that opens the form in edit mode', async ({ page }) => {
  await bootSignedIn(page, 'admin');
  await page.evaluate(() => {
    window.__vm.selectedEval = {
      id: 'e1', studentId: 's1', studentName: 'Ihab Abou Ali', aircraftType: 'R44',
      phaseName: 'CONTACT', tripNumber: 'S2', date: 1755000000, instructorName: 'IP One',
      duration: '01:00', finalGrade: 85, overallMifStatus: 'STANDARD', flightYear: '2026-2027',
      tripNotes: 'solid hover work', maneuverGrades: [],
    };
  });

  await page.getByRole('button', { name: 'Edit', exact: true }).click();

  await expect.poll(async () => page.evaluate(() => ({
    modal: window.__vm.showEvalModal,
    mode: window.__vm.evalFormMode,
    trip: window.__vm.evalForm.tripNumber,
    detail: !!window.__vm.selectedEval,
  }))).toEqual({ modal: true, mode: 'edit', trip: 'S2', detail: false });
});

test('a non-admin never sees the Edit button', async ({ page }) => {
  await bootSignedIn(page, 'instructor');
  await page.evaluate(() => {
    window.__vm.selectedEval = {
      id: 'e1', studentId: 's1', studentName: 'Ihab Abou Ali', aircraftType: 'R44',
      phaseName: 'CONTACT', tripNumber: 'S2', date: 1755000000, instructorName: 'IP One',
      duration: '01:00', finalGrade: 85, overallMifStatus: 'STANDARD', flightYear: '2026-2027',
      maneuverGrades: [],
    };
  });

  await expect(page.getByRole('button', { name: 'Print PDF' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
});
