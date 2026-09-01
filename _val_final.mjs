import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 800 } });
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:4181/student-grading-portal-web/', { waitUntil: 'networkidle' });
await p.waitForTimeout(2500);
const out = await p.evaluate(async () => {
  const vm = window.__vm;
  vm.uiDensity = 'compact'; await vm.$nextTick();
  const densityApplied = document.documentElement.classList.contains('compact') || document.body.className;
  // backup export present?
  vm.setTab('settings'); await vm.$nextTick();
  const settingsText = [...document.querySelectorAll('#app section')].map(s=>s.innerText).join('\n');
  return {
    densityApplied,
    hasBackup: /backup|export/i.test(settingsText),
    hasRestore: /restore|import/i.test(settingsText),
    hasClearData: /clear/i.test(settingsText),
  };
});
console.log(JSON.stringify({ out, errs }, null, 1));
await b.close();
