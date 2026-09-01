import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 800 } });
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:4181/student-grading-portal-web/', { waitUntil: 'networkidle' });
await p.waitForTimeout(3000);
// Inspect the pre-auth DOM: skip-link, nav, login form
const info = await p.evaluate(() => ({
  skipLinkHTML: (document.querySelector('.skip-link')||{}).outerHTML || null,
  allLinks: [...document.querySelectorAll('a')].slice(0,5).map(a=>a.className+':'+(a.textContent||'').trim().slice(0,20)),
  appHTMLStart: (document.querySelector('#app')||document.body).innerHTML.slice(0,400),
}));
console.log(JSON.stringify({ info, errs }, null, 1));
await b.close();
