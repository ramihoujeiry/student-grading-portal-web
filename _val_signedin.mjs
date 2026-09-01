import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:4181/student-grading-portal-web/', { waitUntil: 'networkidle' });
await p.waitForTimeout(3000);
// Simulate logged-in state via the app's own persistence if possible; check store keys
const sim = await p.evaluate(async () => {
  const vm = window.__vm;
  // try to force loggedIn true to render the shell (UI-level validation only)
  if (vm) { vm.loggedIn = true; vm.user = { email:'test@squadron', role:'admin', uid:'t' }; await vm.$nextTick(); }
  return {
    hasVm: !!vm,
    tabs: [...document.querySelectorAll('.tab-btn')].map(b=>b.textContent.trim()),
    skipLink: !!document.querySelector('.skip-link'),
    ariaLive: document.querySelectorAll('[aria-live]').length,
    settingsSection: !!document.querySelector('section[v-show]') ,
    meters: document.querySelectorAll('.meter-fill').length,
  };
});
console.log(JSON.stringify({ sim, errs }, null, 1));
await b.close();
