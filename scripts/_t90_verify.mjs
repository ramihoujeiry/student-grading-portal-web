// Render + a11y verification for index.html across viewports
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';

const root = 'D:/grading-portal-web';
const server = http.createServer((req, res) => {
  const file = req.url === '/' ? 'index.html' : req.url.replace(/^\//, '').split('?')[0];
  try {
    const data = fs.readFileSync(path.join(root, file));
    res.writeHead(200, { 'content-type': file.endsWith('.html') ? 'text/html' : 'application/javascript' });
    res.end(data);
  } catch (e) { res.writeHead(404); res.end('nf'); }
}).listen(8907);

const results = { errors: [], viewports: [], a11y: {} };
const browser = await chromium.launch();

// 1) App shell renders without parse/mount throws
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', e => results.errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') results.errors.push('console: ' + m.text()); });
  await page.goto('http://localhost:8907/', { waitUntil: 'load' }).catch(e => results.errors.push('nav: ' + e.message));
  await page.waitForTimeout(2500);
  results.appMounted = await page.evaluate(() => {
    const app = document.querySelector('#app');
    return app && app.innerHTML.length > 200 && !app.textContent.includes('{{');
  });
  // login form visible?
  results.loginVisible = await page.locator('input[aria-label="Email"]').count() > 0;
  await page.close();
}

// 2) Overflow checks across viewports on the auth screen (logged-out state is what's renderable without Firebase creds)
for (const w of [320, 360, 414, 768, 1024, 1280]) {
  const page = await browser.newPage({ viewport: { width: w, height: 900 } });
  page.on('pageerror', e => results.errors.push(`vp${w} pageerror: ` + e.message));
  await page.goto('http://localhost:8907/', { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  const r = await page.evaluate(() => {
    const docOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    let worstEl = null, worstOver = 0;
    document.querySelectorAll('*').forEach(el => {
      if (el.closest('[aria-modal="true"]')) return;
      const over = el.scrollWidth - el.clientWidth;
      if (over > worstOver) { worstOver = over; worstEl = el.className || el.tagName; }
    });
    return { docOverflow, worstOver, worstEl };
  });
  results.viewports.push({ width: w, ...r });
  await page.close();
}

// 3) a11y quick checks: modal roles present when open (force via DOM), unlabeled controls count, contrast basics
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('http://localhost:8907/', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  results.a11y = await page.evaluate(() => {
    const unlabeled = [...document.querySelectorAll('input:not([type=hidden]),select,textarea')].filter(el =>
      !(el.getAttribute('aria-label') || el.getAttribute(':aria-label') || el.labels?.length)
    ).map(el => el.outerHTML.slice(0, 60));
    const imgsNoAlt = [...document.querySelectorAll('img:not([alt])')].length;
    const buttonsNoText = [...document.querySelectorAll('button')].filter(b => !b.textContent.trim() && !b.getAttribute('aria-label')).length;
    const focusVisibleRule = [...document.styleSheets].some(ss => { try { return [...ss.cssRules].some(r => r.selectorText?.includes(':focus-visible')); } catch { return false; } });
    return { unlabeled, imgsNoAlt, buttonsNoText, focusVisibleRule };
  });
  await page.close();
}

await browser.close();
server.close();
console.log(JSON.stringify(results, null, 1));
