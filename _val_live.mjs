import { chromium } from '@playwright/test';
const errors = [];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
p.on('pageerror', e => errors.push('pageerror: ' + e.message));
p.on('console', m => { if (m.type() === 'error' && !m.text().includes('Firebase') && !m.text().includes('auth/')) errors.push('console: ' + m.text()); });
await p.goto('http://localhost:4181/student-grading-portal-web/', { waitUntil: 'networkidle', timeout: 45000 }).catch(e => errors.push('nav: ' + e.message));
await p.waitForTimeout(4000);
// login wall present?
const hasLogin = await p.locator('input[type="email"], input[type="password"]').count();
// mobile viewport check
await p.setViewportSize({ width: 390, height: 780 });
await p.waitForTimeout(1500);
const navVisible = await p.evaluate(() => { const n = document.querySelector('nav'); return n ? { w: n.scrollWidth, cw: n.clientWidth, overflowX: getComputedStyle(n).overflowX } : null; });
const skipLink = await p.locator('.skip-link, a[href="#main"]').count();
const settingsTab = await p.evaluate(() => document.body.innerText.includes('Settings'));
const bundle = await p.evaluate(() => [...document.scripts].map(s => s.src).filter(s => s.includes('index-')).join(','));
console.log(JSON.stringify({ hasLogin, navVisible, skipLink, settingsTab, bundle, nonFirebaseErrors: errors }, null, 1));
await b.close();
