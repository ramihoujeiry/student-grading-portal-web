// t_90a8ab51 final verification pass
import { chromium } from 'playwright';

const BASE = 'http://localhost:4173/student-grading-portal-web/';
const results = { errors: [], htmlServedFor: [], tabs: [], viewports: [], modals: {}, axe: null };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', e => results.errors.push('pageerror: ' + e.message));
page.on('response', async r => {
  const url = r.url();
  if (/\.(js|mjs|json|webmanifest)(\?|$)/.test(url) && !url.includes('firebaseio') && !url.includes('googleapis')) {
    const ct = (r.headers()['content-type'] || '');
    if (ct.includes('text/html')) results.htmlServedFor.push(url);
  }
});

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(3000);

try {
  await page.evaluate(async () => {
    await window.__vm.onUser({ uid: 't90-test-admin', email: 't90@verify.local', displayName: 'T90 Tester', emailVerified: true });
  });
} catch (e) { results.onUserError = String(e.message || e).slice(0, 150); }
await page.waitForTimeout(4000);
results.loggedIn = (await page.evaluate(() => document.body.innerText.length)) > 300;

const tabList = await page.evaluate(() => [...document.querySelectorAll('.tab-btn')].map(b => b.textContent.trim()));
results.tabList = tabList;

for (const t of tabList) {
  try {
    await page.click(`.tab-btn:has-text("${t.replace(/"/g, '')}")`);
    await page.waitForTimeout(1000);
    const info = await page.evaluate(() => {
      const docOver = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      let worst = 0, worstEl = '';
      document.querySelectorAll('main *').forEach(el => {
        if (el.closest('[aria-modal="true"]') || el.tagName === 'TABLE') return;
        const cs = getComputedStyle(el);
        if (cs.overflow === 'hidden' || cs.clip === 'rect(0px, 0px, 0px, 0px)' || cs.position === 'fixed') return;
        const over = el.scrollWidth - el.clientWidth;
        if (over > worst) { worst = over; worstEl = String(el.className || el.tagName).slice(0, 60); }
      });
      return { docOver, worst, worstEl };
    });
    results.tabs.push({ tab: t, ...info });
    await page.screenshot({ path: `test-results/t90f-${t.toLowerCase().replace(/\s+/g, '-')}.png`, fullPage: true });
  } catch (e) { results.tabs.push({ tab: t, error: e.message.slice(0, 120) }); }
}

// modal check
try {
  await page.click('.tab-btn:has-text("Evaluations")');
  await page.waitForTimeout(800);
  const newBtn = page.locator('button:has-text("New"), button:has-text("+")').first();
  if (await newBtn.count()) {
    await newBtn.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(800);
    results.modals = await page.evaluate(() => {
      const m = document.querySelector('[role="dialog"], [aria-modal="true"]');
      return m ? { found: true, role: m.getAttribute('role'), ariaModal: m.getAttribute('aria-modal') } : { found: false };
    });
    if (results.modals.found) {
      for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
      results.modals.focusStaysInModal = await page.evaluate(() =>
        !!document.activeElement.closest('[role="dialog"],[aria-modal="true"]'));
      await page.screenshot({ path: 'test-results/t90f-modal.png', fullPage: true });
      await page.keyboard.press('Escape');
    }
  }
} catch (e) { results.modals.error = e.message.slice(0, 120); }

// responsive pass, logged-in
for (const vp of [{ w: 320, h: 700, n: 'phone-se' }, { w: 360, h: 780, n: 'phone' }, { w: 414, h: 896, n: 'phone-max' }, { w: 768, h: 1024, n: 'tablet' }]) {
  const p2 = await browser.newPage({ viewport: { width: vp.w, height: vp.h }, isMobile: true, hasTouch: true });
  await p2.goto(BASE, { waitUntil: 'load' });
  await p2.waitForTimeout(2500);
  try { await p2.evaluate(async () => { await window.__vm.onUser({ uid: 't90b', email: 't@v.l', displayName: 'T', emailVerified: true }); }); } catch (e) { /* continue with whatever rendered */ }
  await p2.waitForTimeout(3500);
  for (const t of ['Dashboard', 'Evaluations', 'Settings']) {
    try { await p2.click(`.tab-btn:has-text("${t}")`, { timeout: 4000 }); await p2.waitForTimeout(800); } catch (e) {}
  }
  const r = await p2.evaluate(() => ({
    docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    navWrapOk: (() => { const n = document.querySelector('nav.tabs'); return !n || n.scrollWidth <= n.clientWidth + 1; })(),
  }));
  results.viewports.push({ name: vp.n, width: vp.w, ...r });
  await p2.screenshot({ path: `test-results/t90f-${vp.n}.png` });
  await p2.close();
}

// axe scan (desktop dashboard)
try {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  await page.evaluate(async () => { await window.__vm.onUser({ uid: 't90c', email: 't@v.l', displayName: 'T', emailVerified: true }); });
  await page.waitForTimeout(3500);
  await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' });
  const res = await page.evaluate(() => axe.run(document, { resultTypes: ['violations'] }));
  results.axe = res.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help }));
  await page.screenshot({ path: 'test-results/t90f-axe-page.png', fullPage: true });
} catch (e) { results.axe = 'axe error: ' + e.message.slice(0, 150); }

await browser.close();
console.log(JSON.stringify(results, null, 1));
