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
// dashboard filters work?
await page.selectOption('.card select >> nth=0', { label: 'ivan abdalla' }).catch(e=>console.log('filter sel fail'));
await page.waitForTimeout(1500);
const dash = await page.evaluate(() => document.body.innerText);
console.log('filtered count shown:', /FILTERED/.test(dash), (dash.match(/(\d+)\s*\n?FILTERED/)||[])[1]);
await page.click('button:has-text("Clear")').catch(()=>{});
// Analytics tab: maneuver difficulty
await page.click('.tab-btn:has-text("Analytics")');
await page.waitForTimeout(2000);
const an = await page.evaluate(() => document.body.innerText);
console.log('analytics per-student:', /Readiness/.test(an));
console.log('maneuver difficulty:', /Maneuver Difficulty/.test(an));
const meters = await page.locator('.meter-fill').count();
console.log('meter bars:', meters);
await page.screenshot({ path: 'test-results/t30-analytics.png', fullPage: false });
await browser.close();
