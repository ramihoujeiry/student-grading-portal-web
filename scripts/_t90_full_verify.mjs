// t_90a8ab51: render + a11y verification of the built app (vite preview @ :4173)
// Bypasses the emailVerified gate by driving the app's onUser() directly with a
// stubbed admin user, then walks every tab at phone/tablet/desktop viewports.
import { chromium } from 'playwright';

const BASE = 'http://localhost:4173/student-grading-portal-web/';
const results = { errors: [], tabs: [], viewports: [], modals: {}, axe: null };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', e => results.errors.push('pageerror: ' + e.message));
page.on('console', m => {
  if (m.type() === 'error' && !/frame-ancestors|net::|Failed to load resource/.test(m.text()))
    results.errors.push('console: ' + m.text());
});

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(3000);

// Force an authenticated admin session through the real handler.
const target = await page.evaluateHandle(() => window.__vm || null);
if (!(await target.evaluate(t => t && typeof t.onUser === 'function'))) throw new Error('app instance not found');
try {
  await page.evaluate(async t => {
    await t.onUser({ uid: 't90-test-admin', email: 't90@verify.local', displayName: 'T90 Tester', emailVerified: true });
  }, target);
} catch (e) { results.onUserError = String(e && e.message || e).slice(0, 200); }
await page.waitForTimeout(4000);

const bodyLen = await page.evaluate(() => document.body.innerText.length);
results.loggedIn = bodyLen > 300;
results.tabList = await page.evaluate(() =>
  [...document.querySelectorAll('.tab-btn')].map(b => b.textContent.trim()));
await page.screenshot({ path: 'test-results/t90-desktop-dashboard.png', fullPage: true });

// Walk each tab on desktop
for (const t of results.tabList) {
  try {
    await page.click(`.tab-btn:has-text("${t.replace(/"/g, '')}")`);
    await page.waitForTimeout(1200);
    const info = await page.evaluate(() => {
      const docOver = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      let worst = 0, worstEl = '';
      document.querySelectorAll('main *').forEach(el => {
        if (el.closest('[aria-modal="true"]') || el.tagName === 'TABLE') return;
        const over = el.scrollWidth - el.clientWidth;
        if (over > worst) { worst = over; worstEl = el.className || el.tagName; }
      });
      return { docOver, worst, worstEl, text: document.body.innerText.length };
    });
    results.tabs.push({ tab: t, ...info });
    if (['Dashboard', 'Evaluations', 'Analytics', 'MIF Tables'].includes(t))
      await page.screenshot({ path: `test-results/t90-tab-${t.toLowerCase().replace(/\s+/g, '-')}.png`, fullPage: true });
  } catch (e) { results.tabs.push({ tab: t, error: e.message.slice(0, 120) }); }
}

// Modal a11y check: open New Evaluation modal if reachable
try {
  await page.click('.tab-btn:has-text("Evaluations")');
  await page.waitForTimeout(800);
  const newBtn = page.locator('button:has-text("New"), button:has-text("+")').first();
  if (await newBtn.count()) {
    await newBtn.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(800);
    results.modals = await page.evaluate(() => {
      const m = document.querySelector('[role="dialog"], [aria-modal="true"]');
      return m ? { found: true, role: m.getAttribute('role'), ariaModal: m.getAttribute('aria-modal'), labelledby: !!(m.getAttribute('aria-labelledby') || m.querySelector('h2,h3,[aria-label]')) } : { found: false };
    });
    // focus trap smoke: Tab cycles inside modal
    if (results.modals.found) {
      for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
      results.modals.focusStaysInModal = await page.evaluate(() =>
        !!document.activeElement.closest('[role="dialog"],[aria-modal="true"]'));
      await page.keyboard.press('Escape');
    }
  }
} catch (e) { results.modals.error = e.message.slice(0, 120); }

// Responsive pass: mobile + tablet across key tabs
for (const vp of [{ w: 320, h: 700, n: 'phone-se' }, { w: 360, h: 780, n: 'phone' }, { w: 414, h: 896, n: 'phone-max' }, { w: 768, h: 1024, n: 'tablet' }]) {
  const p2 = await browser.newPage({ viewport: { width: vp.w, height: vp.h }, isMobile: true, hasTouch: true });
  p2.on('pageerror', e => results.errors.push(`vp${vp.w} pageerror: ` + e.message));
  await p2.goto(BASE, { waitUntil: 'load' });
  await p2.waitForTimeout(2500);
  const t = await p2.evaluateHandle(() => (window.__vm) || null);
  try { await p2.evaluate(async vm => { if (vm) await vm.onUser({ uid: 't90a', email: 't@v.l', displayName: 'T', emailVerified: true }); }, t); } catch (e) { results.errors.push(`vp${vp.w} onUser: ` + String(e.message||e).slice(0,120)); }
  await p2.waitForTimeout(3500);
  for (const t of ['Dashboard', 'Evaluations']) {
    try {
      await p2.click(`.tab-btn:has-text("${t}")`, { timeout: 4000 });
      await p2.waitForTimeout(1000);
    } catch (e) {}
  }
  const r = await p2.evaluate(() => ({
    docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    navWrapOk: (() => { const n = document.querySelector('nav.tabs'); return !n || n.scrollWidth <= n.clientWidth + 1; })(),
  }));
  results.viewports.push({ name: vp.n, width: vp.w, ...r });
  await p2.screenshot({ path: `test-results/t90-${vp.n}.png`, fullPage: false });
  await p2.close();
}

// axe-core scan on the logged-in dashboard
try {
  await page.evaluate(() => { const s = document.createElement('script'); s.src = '/student-grading-portal-web/node_modules/axe-core/axe.min.js'; document.head.appendChild(s); return new Promise(r => { s.onload = r; s.onerror = r; }); });
  await page.waitForFunction(() => window.axe, { timeout: 5000 }).catch(() => {});
  if (await page.evaluate(() => !!window.axe)) {
    const res = await page.evaluate(() => axe.run(document, { resultTypes: ['violations'] }));
    results.axe = res.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help }));
  } else results.axe = 'axe not loadable';
} catch (e) { results.axe = 'axe error: ' + e.message.slice(0, 120); }

await browser.close();
console.log(JSON.stringify(results, null, 1));
