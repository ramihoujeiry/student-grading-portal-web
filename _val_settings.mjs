import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:4181/student-grading-portal-web/', { waitUntil: 'networkidle' });
await p.waitForTimeout(2500);
const out = await p.evaluate(async () => {
  const vm = window.__vm;
  vm.loggedIn = true; vm.user = { email:'t@s', role:'admin', uid:'t' };
  vm.setTab('settings'); await vm.$nextTick();
  const visSec = [...document.querySelectorAll('#app section')].find(s => s.offsetParent !== null);
  const txt = (visSec?.innerText||'').replace(/\s+/g,' ');
  return {
    visibleSectionHead: txt.slice(0,60),
    hasBackup: /Export backup/.test(txt), hasImport: /Import backup/.test(txt),
    hasClear: /Clear local analytics/.test(txt),
    backupFn: typeof vm.backupExport === 'function',
    importFn: typeof vm.backupImportFile === 'function',
    clearFn: typeof vm.clearLocalData === 'function',
    // exercise export in-memory
    exportTest: await (async () => { try { const orig = URL.createObjectURL; let captured=null;
      // just verify function runs without throw when Firestore offline
      await vm.backupExport(); return 'ran'; } catch(e){ return 'throw: '+e.message; } })(),
  };
});
console.log(JSON.stringify({ out, errs }, null, 1));
await b.close();
