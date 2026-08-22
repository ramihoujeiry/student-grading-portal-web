// End-to-end live test of the WEB app's online AI path against the Pi proxy,
// confirming the RAG block is injected and the model cites the manuals.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const sandbox = { window: {}, console, setTimeout, clearTimeout, fetch: (...a) => fetch(...a),
  document: { getElementById: () => null } };
sandbox.window = sandbox; sandbox.global = sandbox;
vm.createContext(sandbox);

vm.runInContext(fs.readFileSync(path.join(__dirname, 'faa_index.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'faaRag.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'store.js'), 'utf8'), sandbox);

(async () => {
  await sandbox.FaaRag.loadIndex();
  // minimal config pointing at the live Pi proxy (Funnel URL)
  const cfg = { endpoint: 'https://raspberrypi.tail3a08db.ts.net/v1/chat/completions',
                model: 'tencent/hy3:free', apiKey: '' };
  // a confined-area-ish perf object like Ali
  const data = sandbox.buildPerformance
    ? sandbox.buildPerformance(
        { id: 's_ali', name: 'Cadet Ali Alawiyeh' },
        [{ studentId:'s_ali', studentName:'Cadet Ali Alawiyeh', phaseName:'CONFINED AREAS',
           tripNumber:'S77', date:1751155200, finalGrade:85.6, overallMifStatus:'BELOW STANDARD',
           maneuverGrades:[
             {name:'Low recon',studentGrade:1,requiredMif:2,factor:1.5},
             {name:'Oral',studentGrade:1,requiredMif:2,factor:1},
             {name:'Pre-flight / Walk-around',studentGrade:4,requiredMif:2,factor:1},
             {name:'RADIO COMMUNICATION/ SA',studentGrade:3,requiredMif:2,factor:1},
           ],
           instructorNotes:'good trip, needs oral prep; low recon parameters off; confined area high recon not maintained' }])
    : { studentName:'Cadet Ali Alawiyeh', weakManeuvers:[
         {name:'Low recon',avgGrade:1,requiredMif:2,trend:'flat'},
         {name:'Oral',avgGrade:1,requiredMif:2,trend:'flat'}], overallScore:85.6,
        evaluationCount:1, firstDateLabel:'29 Jun 2026', lastDateLabel:'29 Jun 2026',
        volatility:0, trend:'Stable', noteThemes:[], instructorNotes:[],
        practicalScores:{'Low recon':1,'Oral':1,'Pre-flight / Walk-around':4}, bestManeuver:'', phaseScores:{} };

  const prompt = await sandbox.buildAIPrompt(data);
  const hasRag = /REFERENCE SOURCE MATERIAL/.test(prompt.user);
  console.log('RAG block injected into online prompt:', hasRag);

  try {
    const text = await sandbox.callAIModel(data, cfg);
    console.log('\n===== LIVE ONLINE DEBRIEF (Pi proxy) =====\n');
    console.log(text.slice(0, 1400));
    const cited = /\(FAA-H-8083-25B,? p\.|\(UH-1 IPC,? p\.|\(Robinson FTG,? p\./.test(text);
    console.log('\n>>> cites a manual (FAA/UH-1/FTG p.N):', cited);
    process.exit(cited ? 0 : 2);
  } catch (e) {
    console.log('ONLINE CALL FAILED:', e.message);
    console.log('(offline path would now still cite manuals via today\'s fix)');
    process.exit(3);
  }
})();
