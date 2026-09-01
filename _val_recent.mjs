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
  const now = Date.now()/1000;
  vm.students = [{ id:'s1', name:'Cadet Alpha', active:true }, { id:'s2', name:'Cadet Bravo', active:true }];
  vm.evaluations = [
    { id:'e1', studentId:'s1', instructorId:'i1', finalGrade:85, overallMifStatus:'MEETS STANDARD', flightHours:12.5, date:now, aircraftId:'a1', flightYear:'2026', maneuvers:[{maneuver:'Hover',studentGrade:3}] },
    { id:'e2', studentId:'s2', instructorId:'i1', finalGrade:65, overallMifStatus:'BELOW STANDARD', flightHours:8.0, date:now-86400, aircraftId:'a1', flightYear:'2026', maneuvers:[{maneuver:'Hover',studentGrade:1},{maneuver:'Taxi',studentGrade:1}] },
  ];
  vm.instructors=[{id:'i1',name:'IP Smith',active:true}]; vm.aircraft=[{id:'a1',tail:'N123',active:true}];
  await vm.$nextTick(); await new Promise(r=>setTimeout(r,300));
  vm.setTab('dashboard'); await vm.$nextTick();
  const dash = [...document.querySelectorAll('#app section')].find(s=>s.offsetParent!==null);
  const t=(dash?.innerText||'').replace(/\s+/g,' ');
  const ri=t.indexOf('Recent Evaluations');
  // mif difficulty meters need mif tables
  vm.mifTables=[{id:'m1',name:'Primary',maneuvers:[{name:'Hover',requiredGrade:75,grades:[{studentId:'s2',grade:1}]},{name:'Taxi',requiredGrade:75,grades:[]}]}];
  await vm.$nextTick();
  return {
    recent: ri>=0 ? t.slice(ri,ri+200) : null,
    readiness: (t.match(/Class Readiness.{0,260}/)||[null])[0],
    filtersWork: !!document.querySelector('#app select'),
  };
});
console.log(JSON.stringify({ out, errs }, null, 1));
await p.screenshot({ path: '_val_dash2.png' });
await b.close();
