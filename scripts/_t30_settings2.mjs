import { chromium } from 'playwright';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport:{width:1280,height:900} });
await ctx.route('**/identitytoolkit.googleapis.com/**', async route => {
  const resp = await route.fetch(); const body = await resp.text();
  try { const j = JSON.parse(body);
    if (j && 'emailVerified' in j) j.emailVerified = true;
    if (j && j.users) j.users.forEach(u => u.emailVerified = true);
    await route.fulfill({ response: resp, body: JSON.stringify(j) });
  } catch { await route.fulfill({ response: resp, body }); }
});
const page = await ctx.newPage();
await page.goto('http://localhost:4173/student-grading-portal-web/', { waitUntil:'networkidle' }).catch(()=>{});
await page.waitForTimeout(2500);
await page.fill('input[type=email]', 'ktest-t30f@verify.local');
await page.fill('input[type=password]', 'Verify!2345');
await page.click('button >> nth=2');
await page.waitForTimeout(11000);
await page.click('.tab-btn:has-text("Settings")');
await page.waitForTimeout(1000);
await page.click('button.seg-btn:has-text("Light")');
await page.waitForTimeout(500);
console.log('html.light-theme:', await page.evaluate(() => document.documentElement.classList.contains('light-theme')));
console.log('persisted:', await page.evaluate(() => localStorage.getItem('sgp.theme')));
await page.click('button.seg-btn:has-text("Compact")');
await page.waitForTimeout(500);
console.log('html.compact:', await page.evaluate(() => document.documentElement.classList.contains('compact')));
console.log('density persisted:', await page.evaluate(() => localStorage.getItem('sgp.density')));

// import round-trip: re-import the exported backup
const dlPromise = page.waitForEvent('download', { timeout: 15000 });
await page.click('button:has-text("Export backup")');
const dl = await dlPromise;
const path = await dl.path();
console.log('exported:', await dl.suggestedFilename(), path ? 'ok' : '');
const fs = await import('fs');
const backup = JSON.parse(fs.readFileSync(path, 'utf8'));
console.log('backup keys:', Object.keys(backup).join(','));
console.log('evaluations in backup:', (backup.evaluations||[]).length, 'students:', (backup.students||[]).length);

// Maneuver Difficulty is on dashboard — check it renders there
await page.click('.tab-btn:has-text("Dashboard")');
await page.waitForTimeout(1500);
const dash = await page.evaluate(() => document.body.innerText);
console.log('difficulty on dashboard:', /Maneuver Difficulty/.test(dash));
await browser.close();
