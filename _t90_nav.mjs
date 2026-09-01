import { chromium } from 'playwright';
const BASE = 'http://localhost:4173/student-grading-portal-web/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 320, height: 700 }, isMobile: true, hasTouch: true });
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(2500);
const t = await page.evaluateHandle(() => window.__vm || null);
try { await page.evaluate(async vm => { if (vm) await vm.onUser({ uid:'x', email:'t@v.l', displayName:'T', emailVerified:true }); }, t); } catch {}
await page.waitForTimeout(3000);
const info = await page.evaluate(() => {
  const n = document.querySelector('nav.tabs');
  const btns = [...n.querySelectorAll('.tab-btn, .tab-sep')];
  return {
    navClient: n.clientWidth, navScroll: n.scrollWidth,
    overflows: n.scrollWidth > n.clientWidth + 1,
    btnCount: btns.length,
    btnWidths: btns.slice(0,10).map(b => ({ cls: b.className, w: b.offsetWidth })),
    minwidth: getComputedStyle(n.querySelector('.tab-btn')).minWidth,
  };
});
console.log(JSON.stringify(info, null, 1));
await page.screenshot({ path: 'test-results/t90-nav-320.png' });
await browser.close();
