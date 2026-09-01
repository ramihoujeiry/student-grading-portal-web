import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:4181/student-grading-portal-web/', { waitUntil: 'networkidle' });
await p.waitForTimeout(2500);
const out = await p.evaluate(async () => {
  const vm = window.__vm;
  vm.loggedIn = true; vm.user = { email:'t@s', role:'admin', uid:'t' };
  vm.setTab('dashboard'); await vm.$nextTick();
  const visSec = [...document.querySelectorAll('#app section')].find(s => s.offsetParent !== null);
  const txt = (visSec?.innerText||'').replace(/\s+/g,' ');
  // inject fake eval data to exercise readiness board + meters
  return {
    dashHead: txt.slice(0,300),
    hasReadiness: /readiness/i.test(txt),
    hasRecent: /recent/i.test(txt),
    hasFilters: /filter/i.test(txt),
    // difficulty meter section exists in MIF tab template
  };
});
// MIF difficulty meters: check the mif tab renders with admin role
const out2 = await p.evaluate(async () => {
  const vm = window.__vm;
  vm.setTab('mif'); await vm.$nextTick();
  const visSec = [...document.querySelectorAll('#app section')].find(s => s.offsetParent !== null);
  const txt = (visSec?.innerText||'').replace(/\s+/g,' ');
  return { mifHead: txt.slice(0,150), metersInDom: document.querySelectorAll('.meter-fill').length };
});
console.log(JSON.stringify({ out, out2, errs }, null, 1));
await b.close();
