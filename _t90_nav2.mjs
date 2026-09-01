import { chromium } from 'playwright';
const BASE = 'http://localhost:4173/student-grading-portal-web/';
const browser = await chromium.launch();
for (const w of [320, 360, 414, 768]) {
  const page = await browser.newPage({ viewport: { width: w, height: 800 }, isMobile: true, hasTouch: true });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const t = await page.evaluateHandle(() => window.__vm || null);
  try { await page.evaluate(async vm => { if (vm) await vm.onUser({ uid:'x', email:'t@v.l', displayName:'T', emailVerified:true }); }, t); } catch {}
  await page.waitForTimeout(2500);
  const info = await page.evaluate(() => {
    const n = document.querySelector('nav.tabs');
    if (!n) return { none: true };
    return { navClient: n.clientWidth, navScroll: n.scrollWidth, overflows: n.scrollWidth > n.clientWidth + 1,
      rows: Math.round(n.getBoundingClientRect().height / (n.querySelector('.tab-btn').getBoundingClientRect().height + 6)),
      mediaMatch: matchMedia('(max-width:560px)').matches };
  });
  console.log(w, JSON.stringify(info));
  await page.screenshot({ path: `test-results/t90-nav-${w}.png` });
  await page.close();
}
await browser.close();
