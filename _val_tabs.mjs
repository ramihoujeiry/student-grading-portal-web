import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
p.on('pageerror', e => errs.push('pageerror: ' + e.message));
await p.goto('http://localhost:4181/student-grading-portal-web/', { waitUntil: 'networkidle' });
await p.waitForTimeout(3000);
const out = await p.evaluate(async () => {
  const vm = window.__vm;
  vm.loggedIn = true; vm.user = { email:'test@squadron', role:'admin', uid:'t' };
  const results = {};
  for (const t of ['dashboard','students','evaluations','announcements','analytics','ai','ask','settings']) {
    vm.setTab(t); await vm.$nextTick();
    const sec = [...document.querySelectorAll('#app section')].find(s => s.style.display !== 'none' && s.offsetParent !== null);
    results[t] = { textLen: (sec?.innerText||'').length, head: (sec?.innerText||'').replace(/\s+/g,' ').slice(0,80) };
  }
  results.ariaLive = document.querySelectorAll('[aria-live]').length;
  results.meters = document.querySelectorAll('.meter-fill').length;
  return results;
});
console.log(JSON.stringify({ out, errs }, null, 1));
await b.close();
