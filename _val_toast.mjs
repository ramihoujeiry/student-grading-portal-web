import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 800 } });
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:4181/student-grading-portal-web/', { waitUntil: 'networkidle' });
await p.waitForTimeout(2500);
const out = await p.evaluate(async () => {
  const vm = window.__vm;
  vm.loggedIn = true; vm.user = { email:'t@s', role:'admin', uid:'t' }; vm.setTab('dashboard'); await vm.$nextTick();
  // toast a11y
  vm.toastMsg('Test toast', 'error'); await vm.$nextTick();
  const toast = document.querySelector('.toast');
  const toastOk = toast ? { text: toast.textContent, live: toast.getAttribute('aria-live'), role: toast.getAttribute('role') } : null;
  vm.toastMsg('', 'info'); await vm.$nextTick();
  // theme toggle
  const before = document.documentElement.getAttribute('data-theme') || '';
  if (typeof vm.setTheme === 'function') vm.setTheme('light'); else if (vm.settings) vm.settings.theme='light';
  await vm.$nextTick(); await new Promise(r=>setTimeout(r,100));
  const after = document.documentElement.getAttribute('data-theme') || getComputedStyle(document.body).backgroundColor;
  // nav wrap on mobile
  const nav = document.querySelector('nav.tabs');
  const navStyle = nav ? { overflowX: getComputedStyle(nav).overflowX, flexWrap: getComputedStyle(nav).flexWrap } : null;
  return { toastOk, themeBefore: before, themeAfter: after, navStyle };
});
console.log(JSON.stringify({ out, errs }, null, 1));
await b.close();
