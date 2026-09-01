import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport:{width:1280,height:900} });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto('http://localhost:4173/student-grading-portal-web/', { waitUntil:'networkidle' }).catch(()=>{});
await page.waitForTimeout(2500);
await page.fill('input[type=email]', 'ktest-t30f@verify.local');
await page.fill('input[type=password]', 'Verify!2345');
await page.click('button >> nth=2');
await page.waitForTimeout(12000);
let txt = await page.evaluate(() => document.body.innerText);
console.log('after login LEN:', txt.length);
if (/verify your email/i.test(txt)) {
  console.log('STILL emailVerified gate — client checks Auth profile, not Firestore. Cannot bypass.');
  await browser.close(); process.exit(2);
}
console.log(txt.slice(0, 1500));
// tabs
const tabs = await page.evaluate(() => [...document.querySelectorAll('.tab-btn')].map(b=>b.textContent.trim()));
console.log('TABS:', tabs);
for (const t of tabs) {
  if (t === 'Settings') {
    await page.click(`.tab-btn:has-text("Settings")`);
    await page.waitForTimeout(1000);
    const s = await page.evaluate(() => document.body.innerText);
    console.log('SETTINGS has theme:', /Dark/.test(s)&&/Light/.test(s), '| density:', /Compact/.test(s), '| backup:', /Export backup/.test(s), '| clear:', /Clear local analytics/.test(s));
  }
}
await page.screenshot({ path: 'test-results/t30-main.png', fullPage: true });
console.log('ERRS:', errs.slice(0,5));
await browser.close();
