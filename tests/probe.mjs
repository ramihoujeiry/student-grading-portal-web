// Diagnostic with a hard watchdog: never hang the parent command.
import { chromium } from '@playwright/test';

const WATCHDOG_MS = 35000;
const watchdog = setTimeout(() => {
  console.error('WATCHDOG: forcing exit after', WATCHDOG_MS, 'ms');
  process.exit(3);
}, WATCHDOG_MS);

const candidates = [
  { tag: 'system-chrome', exe: 'C:/Program Files/Google/Chrome/Application/chrome.exe' },
  { tag: 'bundled', exe: undefined }, // let Playwright pick its bundled chromium
];
const args = ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-setuid-sandbox'];

async function tryLaunch(c) {
  try {
    const opts = { headless: true, args };
    if (c.exe) opts.executablePath = c.exe;
    const browser = await chromium.launch(opts);
    const page = await browser.newPage();
    await page.setContent('<h1>hi</h1>');
    const txt = await page.locator('h1').textContent();
    await browser.close();
    return { tag: c.tag, ok: true, txt };
  } catch (e) {
    return { tag: c.tag, ok: false, err: String(e && e.message || e) };
  }
}

(async () => {
  for (const c of candidates) {
    const r = await tryLaunch(c);
    console.log(JSON.stringify(r));
    if (r.ok) { console.log('WINNER:', r.tag); clearTimeout(watchdog); process.exit(0); }
  }
  console.log('ALL-LAUNCHES-FAILED');
  clearTimeout(watchdog);
  process.exit(1);
})();
