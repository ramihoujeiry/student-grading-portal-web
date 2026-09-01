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
  // classManeuverDifficulty reads evaluations[].maneuverGrades with name/factor/requiredMif/studentGrade
  vm.evaluations = [
    { id:'e1', maneuverGrades:[
      {name:'Hover', factor:1, requiredMif:75, studentGrade:3},
      {name:'Autorotation', factor:2, requiredMif:85, studentGrade:1},
      {name:'Hover', factor:1, requiredMif:75, studentGrade:4},
    ]},
  ];
  const computed = vm.classManeuverDifficulty;
  // render on analytics tab (where the meter section lives per index.html line ~525)
  vm.setTab('analytics'); await vm.$nextTick();
  const meters = [...document.querySelectorAll('.meter-fill')].map(m=>({w:m.style.width, label:m.parentElement.getAttribute('aria-label')}));
  return { computed, meters, errsInFn: null };
});
console.log(JSON.stringify({ out, errs }, null, 1));
await p.screenshot({ path: '_val_analytics.png' });
await b.close();
