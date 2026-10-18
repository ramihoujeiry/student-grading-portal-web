// Regression tests for the two New Evaluation defects:
//
//  1) "Suggested trip not filled in" — the aircraft / student / phase pickers used
//     @change="onEvalContextChange; suggestTrip". Vue compiles that as an inline
//     STATEMENT, so it only evaluated the two function references and never called
//     them: after picking student + aircraft + phase the trip number stayed empty.
//     These specs drive the real <select> elements (not vm methods) so they fail
//     if the handler wiring regresses again.
//
//  2) "Instructor notes typing is sluggish" — the notes textarea was bound with
//     v-model to the form, so every keystroke was a reactive write that re-rendered
//     the entire app template. It is now uncontrolled: input is buffered (no
//     synchronous model write) and committed on idle / blur / before save.
//
// Runs against the live-parity fixture (real src/app.js + src/index.html, stubbed
// Firebase) served by tests/serve.mjs.

import { test, expect } from '@playwright/test';

const CONTACT_MANEUVERS = [
  { name: 'Hover', factor: 1, stageMifs: { S1: 2, S2: 3, S3: 4 } },
  { name: 'Traffic Pattern', factor: 1.5, stageMifs: { S1: 2, S2: 3, S3: 4 } },
];

// Boot the app signed-in (the fixture has no Firebase) with a small dataset and
// open the New Evaluation modal.
async function openNewEvalForm(page) {
  await page.evaluate(() => {
    const vm = window.__vm;
    vm.user = { uid: 'test-user', displayName: 'Test IP', emailVerified: true };
    vm.role = 'instructor';
    vm.mifTables = [
      { id: 't1', aircraftType: 'R44', phaseName: 'CONTACT', stages: ['S1', 'S2', 'S3'], maneuvers: [] },
      { id: 't2', aircraftType: 'R44', phaseName: 'PRECISION', stages: ['S1', 'S2'], maneuvers: [] },
    ];
    vm.students = [
      { id: 's1', name: 'John Doe', active: true },
      { id: 's2', name: 'Jane Roe', active: true },
    ];
    vm.instructors = [{ id: 'i1', name: 'IP One', active: true }];
    vm.aircraft = [{ id: 'a1', name: 'R44' }];
    vm.evaluations = [
      { id: 'e1', studentId: 's1', studentName: 'John Doe', aircraftType: 'R44', phaseName: 'CONTACT', tripNumber: 'S2', date: 1755000000, maneuverGrades: [] },
      // Beyond the stage list: last graded S7 in a phase that only lists S1..S3.
      { id: 'e2', studentId: 's2', studentName: 'Jane Roe', aircraftType: 'R44', phaseName: 'CONTACT', tripNumber: 'S7', date: 1755000000, maneuverGrades: [] },
    ];
    vm.openNewEval();
  });
  await page.waitForSelector('.modal.full');
}

const TRIP_SELECT = 'select[aria-label="Evaluation trip number"]';

test.beforeEach(async ({ page }) => {
  await page.goto('/app.html');
  await page.waitForFunction(() => window.__vm && typeof window.__vm.openNewEval === 'function', null, { timeout: 30000 });
  await page.evaluate(() => localStorage.clear());
});

test('picking aircraft + student + phase auto-fills the suggested trip number', async ({ page }) => {
  await openNewEvalForm(page);

  // Nothing to suggest yet: trip starts empty and is shown as such.
  expect(await page.inputValue(TRIP_SELECT)).toBe('');

  await page.selectOption('select[aria-label="Evaluation aircraft"]', 'R44');
  await page.selectOption('select[aria-label="Evaluation student"]', 's1');
  await page.selectOption('select[aria-label="Evaluation phase"]', 'CONTACT');

  // Last graded trip for John Doe / R44 / CONTACT is S2 -> suggested S3.
  await expect.poll(() => page.evaluate(() => window.__vm.evalForm.tripNumber)).toBe('S3');
  await expect(page.locator(TRIP_SELECT)).toHaveValue('S3');
});

test('suggested trip is selectable even when it falls past the stage list', async ({ page }) => {
  await openNewEvalForm(page);

  await page.selectOption('select[aria-label="Evaluation aircraft"]', 'R44');
  await page.selectOption('select[aria-label="Evaluation student"]', 's2');
  await page.selectOption('select[aria-label="Evaluation phase"]', 'CONTACT');

  // Stages are S1..S3 but the student's last graded trip is S7 -> S8 must be
  // offered as a real option and selected.
  await expect.poll(() => page.evaluate(() => window.__vm.evalForm.tripNumber)).toBe('S8');
  await expect(page.locator(TRIP_SELECT)).toHaveValue('S8');
  expect(await page.locator(TRIP_SELECT + ' option', { hasText: 'S8' }).count()).toBe(1);
});

test('choosing the trip reloads per-stage required MIF for that sortie', async ({ page }) => {
  await openNewEvalForm(page);
  // Seed the MIF table's maneuvers after the modal opened (fresh MIF fixture).
  await page.evaluate((maneuvers) => {
    window.__vm.mifTables[0].maneuvers = maneuvers;
  }, CONTACT_MANEUVERS);

  await page.selectOption('select[aria-label="Evaluation aircraft"]', 'R44');
  await page.selectOption('select[aria-label="Evaluation student"]', 's1');
  await page.selectOption('select[aria-label="Evaluation phase"]', 'CONTACT');

  // Suggested S3 has required MIF 4 for both maneuvers (see stageMifs above).
  await expect.poll(() => page.evaluate(() => window.__vm.evalForm.maneuverGrades.map(m => m.requiredMif)))
    .toEqual([4, 4]);
});

test('editing an existing evaluation never rewrites its trip number', async ({ page }) => {
  await page.evaluate(() => {
    const vm = window.__vm;
    vm.user = { uid: 'test-user', emailVerified: true };
    vm.role = 'instructor';
    vm.mifTables = [
      { id: 't1', aircraftType: 'R44', phaseName: 'CONTACT', stages: ['S1', 'S2', 'S3'], maneuvers: [] },
      { id: 't2', aircraftType: 'R44', phaseName: 'PRECISION', stages: ['S1', 'S2'], maneuvers: [] },
    ];
    vm.editTrip({
      id: 'e9', studentId: 's1', studentName: 'John Doe', aircraftType: 'R44',
      phaseName: 'CONTACT', tripNumber: 'S3', date: 1755000000, tripNotes: 'original note', maneuverGrades: [],
    });
  });
  await page.waitForSelector('.modal.full');

  await page.selectOption('select[aria-label="Evaluation phase"]', 'PRECISION');
  await page.waitForTimeout(150); // let the $nextTick handler settle

  const state = await page.evaluate(() => ({
    trip: window.__vm.evalForm.tripNumber,
    mode: window.__vm.evalFormMode,
  }));
  expect(state.mode).toBe('edit');
  expect(state.trip).toBe('S3');           // unchanged, not re-suggested
  await expect(page.locator(TRIP_SELECT)).toHaveValue('S3');
});

test('notes textarea does not write to the reactive form on every keystroke', async ({ page }) => {
  await openNewEvalForm(page);

  const r = await page.evaluate(() => {
    const vm = window.__vm;
    const ta = document.querySelector('.modal.full textarea');
    vm.evalForm.tripNotes = '';
    // Simulate one keystroke: DOM value changes + input event fires.
    ta.value = 'Hover was unstable';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    const immediate = vm.evalForm.tripNotes;   // must still be buffered
    const flushed = vm.flushTripNotes();       // explicit flush (blur / save path)
    return { immediate, flushed, after: vm.evalForm.tripNotes };
  });

  expect(r.immediate).toBe('');                       // no per-keystroke model write
  expect(r.flushed).toBe('Hover was unstable');
  expect(r.after).toBe('Hover was unstable');
});

test('notes typed in the textarea are committed once the user pauses', async ({ page }) => {
  await openNewEvalForm(page);

  await page.locator('.modal.full textarea').click();
  await page.locator('.modal.full textarea').type('Watch tail rotor drift on the hover.', { delay: 5 });

  await expect.poll(() => page.evaluate(() => window.__vm.evalForm.tripNotes), { timeout: 5000 })
    .toBe('Watch tail rotor drift on the hover.');
});

test('notes typed just before Save are not lost to the debounce buffer', async ({ page }) => {
  await openNewEvalForm(page);

  // Fill the required context so saveEval() proceeds, and stub the write so the
  // spec can assert exactly what would have been persisted.
  const saved = await page.evaluate(async () => {
    const vm = window.__vm;
    vm.evalForm.studentId = 's1';
    vm.evalForm.aircraftType = 'R44';
    vm.evalForm.phaseName = 'CONTACT';
    vm.evalForm.instructorName = 'IP One';
    vm.evalForm.tripNumber = 'S3';
    window.__saved = null;
    vm.persistEval = (ev) => { window.__saved = ev; };

    const ta = document.querySelector('.modal.full textarea');
    ta.value = 'Late note that must not be lost';
    ta.dispatchEvent(new Event('input', { bubbles: true })); // debounce still pending
    await vm.saveEval();
    return window.__saved;
  });

  expect(saved, 'saveEval should have persisted the evaluation').not.toBeNull();
  expect(saved.tripNotes).toBe('Late note that must not be lost');
  expect(saved.tripNumber).toBe('S3');
});

test('reopening the form starts with empty notes and a cleared trip suggestion', async ({ page }) => {
  await openNewEvalForm(page);
  await page.locator('.modal.full textarea').fill('temp');
  await page.evaluate(() => { window.__vm.showEvalModal = false; });

  await openNewEvalForm(page);

  const state = await page.evaluate(() => ({
    notes: window.__vm.evalForm.tripNotes,
    domNotes: document.querySelector('.modal.full textarea').value,
    trip: window.__vm.evalForm.tripNumber,
  }));
  expect(state.notes).toBe('');
  expect(state.domNotes).toBe('');
  expect(state.trip).toBe('');
});
