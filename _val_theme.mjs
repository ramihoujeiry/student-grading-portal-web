import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 800 } });
await p.goto('http://localhost:4181/student-grading-portal-web/', { waitUntil: 'networkidle' });
await p.waitForTimeout(2500);
const out = await p.evaluate(async () => {
  const vm = window.__vm;
  vm.theme = 'light'; await vm.$nextTick(); await new Promise(r=>setTimeout(r,100));
  const hasLightClass = document.documentElement.classList.contains('light-theme');
  const bg = getComputedStyle(document.body).backgroundColor;
  const persisted = localStorage.getItem('sgp.theme');
  // density
  let densityOk = null;
  if ('density' in vm.$data || vm.density !== undefined) {
    try { vm.density = 'compact'; await vm.$nextTick(); densityOk = document.documentElement.className; } catch(e){ densityOk='err:'+e.message; }
  }
  return { hasLightClass, bg, persisted, densityOk };
});
console.log(JSON.stringify(out, null, 1));
await b.close();
