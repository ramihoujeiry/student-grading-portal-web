// modal a11y + axe scan with canEdit admin
import { chromium } from 'playwright';
const BASE = 'http://localhost:4173/student-grading-portal-web/';
const out = {};
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(3000);
try {
  await page.evaluate(async () => {
    await window.__vm.onUser({ uid: 't90d', email: 'admin@verify.local', displayName: 'Admin', emailVerified: true, isAdmin: true, role: 'admin' });
  });
} catch (e) {}
await page.waitForTimeout(4000);
await page.click('.tab-btn:has-text("Evaluations")');
await page.waitForTimeout(1000);
out.canEdit = await page.evaluate(() => !!window.__vm && JSON.stringify(window.__vm.canEdit));
const newBtn = page.locator('button:has-text("New Evaluation")').first();
if (await newBtn.count() && await newBtn.isVisible().catch(() => false)) {
  await newBtn.click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(800);
  out.modal = await page.evaluate(() => {
    const m = document.querySelector('[role="dialog"], [aria-modal="true"]');
    return m ? { found: true, role: m.getAttribute('role'), ariaModal: m.getAttribute('aria-modal'), labelled: !!(m.getAttribute('aria-labelledby') || m.querySelector('h2,h3,[aria-label]')) } : { found: false };
  });
  if (out.modal.found) {
    for (let i = 0; i < 15; i++) await page.keyboard.press('Tab');
    out.modal.focusStaysInModal = await page.evaluate(() => !!document.activeElement.closest('[role="dialog"],[aria-modal="true"]'));
    await page.screenshot({ path: 'test-results/t90f-modal.png', fullPage: true });
    await page.keyboard.press('Escape');
  }
}
// axe on current logged-in view
try {
  await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' });
  const res = await page.evaluate(() => axe.run(document, { resultTypes: ['violations'] }));
  out.axe = res.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help }));
  // also axe the dashboard tab
  await page.click('.tab-btn:has-text("Dashboard")');
  await page.waitForTimeout(1200);
  const res2 = await page.evaluate(() => axe.run(document, { resultTypes: ['violations'] }));
  out.axeDashboard = res2.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help }));
} catch (e) { out.axeErr = String(e.message || e).slice(0, 150); }
await browser.close();
console.log(JSON.stringify(out, null, 1));
