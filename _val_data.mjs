import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:4181/student-grading-portal-web/', { waitUntil: 'networkidle' });
await p.waitForTimeout(2500);
const out = await p.evaluate(async () => {
  const vm = window.__vm;
  vm.loggedIn = true; vm.user = { email:'t@s', role:'admin', uid:'t' };
  // inject synthetic data to exercise dashboard analytics + MIF difficulty meters
  const now = Date.now()/1000;
  vm.students = [
    { id:'s1', name:'Cadet Alpha', active:true },
    { id:'s2', name:'Cadet Bravo', active:true },
    { id:'s3', name:'Cadet Charlie', active:false },
  ];
  vm.evaluations = [
    { id:'e1', studentId:'s1', finalGrade:85, overallMifStatus:'MEETS STANDARD', flightHours:12.5, date:now, maneuvers:[{maneuver:'Hover',studentGrade:3}] },
    { id:'e2', studentId:'s2', finalGrade:65, overallMifStatus:'BELOW STANDARD', flightHours:8.0, date:now-86400, maneuvers:[{maneuver:'Hover',studentGrade:1},{maneuver:'Taxi',studentGrade:1}] },
    { id:'e3', studentId:'s1', finalGrade:95, overallMifStatus:'MEETS STANDARD', flightHours:14.0, date:now-172800, maneuvers:[{maneuver:'Hover',studentGrade:4},{maneuver:'Settling w/ power',studentGrade:2}] },
  ];
  await vm.$nextTick(); await new Promise(r=>setTimeout(r,200));
  vm.setTab('dashboard'); await vm.$nextTick();
  const dash = [...document.querySelectorAll('#app section')].find(s=>s.offsetParent!==null);
  const dashTxt = (dash?.innerText||'').replace(/\s+/g,' ');
  vm.setTab('mif'); await vm.$nextTick();
  const mifTxt = [...document.querySelectorAll('#app section')].map(s=>s.innerText).join(' ');
  return {
    stats: vm.stats,
    readinessShown: /Class Readiness/.test(dashTxt) ? dashTxt.slice(dashTxt.indexOf('Class Readiness'), dashTxt.indexOf('Class Readiness')+220) : null,
    recentShown: (dashTxt.match(/Recent Evaluations.{0,160}/)||[null])[0],
    metersNow: document.querySelectorAll('.meter-fill').length,
    meterLabels: [...document.querySelectorAll('.meter')].slice(0,3).map(m=>m.getAttribute('aria-label')),
  };
});
console.log(JSON.stringify({ out, errs }, null, 1));
await p.screenshot({ path: '_val_dashboard.png', fullPage: false });
await b.close();
