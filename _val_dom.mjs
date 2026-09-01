import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 800 } });
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
await p.waitForTimeout(2500);
// Force-mount the app shell bypassing auth gate if possible; first inspect what renders
const info = await p.evaluate(() => {
  const vm = window.__vm;
  return {
    hasVm: !!vm,
    tab: vm && vm.tab,
    tabsRendered: [...document.querySelectorAll('.tab-btn')].map(b => b.textContent.trim()),
    skipLink: !!document.querySelector('.skip-link'),
    ariaLive: document.querySelectorAll('[aria-live]').length,
    settingsSection: !!document.querySelector("section[v-show], #app section"),
    bodySnippet: document.body.innerText.slice(0, 200),
  };
});
console.log(JSON.stringify({ info, errs }, null, 1));
await b.close();
