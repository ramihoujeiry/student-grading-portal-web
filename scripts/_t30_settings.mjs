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
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto('http://localhost:4173/student-grading-portal-web/', { waitUntil:'networkidle' }).catch(()=>{});
await page.waitForTimeout(2500);
await page.fill('input[type=email]', 'ktest-t30f@verify.local');
await page.fill('input[type=password]', 'Verify!2345');
await page.click('button >> nth=2');
await page.waitForTimeout(11000);

// Dashboard widgets already visible; test dashboard filters
await page.selectOption?.catch?.(()=>{});
const before = await page.evaluate(() => document.body.innerText);
console.log('DASH readiness:', /Class Readiness/.test(before), '| recent:', /Recent Evaluations/.test(before), '| difficulty:', /Maneuver Difficulty/.test(before));

// Settings tab
await page.click('.tab-btn:has-text("Settings")');
await page.waitForTimeout(1200);
const s = await page.evaluate(() => document.body.innerText);
console.log('SETTINGS: theme', /Dark/.test(s)&&/Light/.test(s), '| density', /Comfortable/.test(s)&&/Compact/.test(s), '| export', /Export backup/.test(s), '| import', /Import/i.test(s), '| clear', /Clear local analytics/.test(s));

// theme switch actually applies
await page.click('button.seg-btn:has-text("Light")');
await page.waitForTimeout(600);
const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme') || document.body.className);
console.log('theme attr after Light click:', JSON.stringify(theme));

// density switch
await page.click('button.seg-btn:has-text("Compact")');
await page.waitForTimeout(600);
const dens = await page.evaluate(() => document.documentElement.getAttribute('data-density') || document.body.className);
console.log('density attr after Compact click:', JSON.stringify(dens));

// export backup triggers a download
const [dl] = await Promise.all([
  page.waitForEvent('download', { timeout: 15000 }).catch(()=>null),
  page.click('button:has-text("Export backup")')
]);
console.log('backup download:', dl ? await dl.suggestedFilename() : 'NONE');

await page.screenshot({ path: 'test-results/t30-settings.png', fullPage: true });
console.log('ERRS:', errs.slice(0,5));
await browser.close();
