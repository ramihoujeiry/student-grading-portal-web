import { chromium } from 'playwright';
const BASE = 'http://localhost:4173/student-grading-portal-web/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('requestfailed', r => { if (r.resourceType() === 'script') errs.push('scriptfail: ' + r.url()); });
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(2500);
const t = await page.evaluateHandle(() => window.__vm || null);
try { await page.evaluate(async vm => { if (vm) await vm.onUser({ uid:'x', email:'t@v.l', displayName:'T', emailVerified:true }); }, t); } catch {}
await page.waitForTimeout(3000);
await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' });
const res = await page.evaluate(() => axe.run(document, { resultTypes: ['violations'] }));
console.log(JSON.stringify({
  errors: errs,
  violations: res.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help, tags: v.tags.filter(x => x.startsWith('wcag')) }))
}, null, 1));
await page.screenshot({ path: 'test-results/t90-desktop-final.png', fullPage: true });
await browser.close();
