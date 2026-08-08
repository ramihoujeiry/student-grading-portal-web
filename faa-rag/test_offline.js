// Verify the OFFLINE template (generateFeedback) now cites the embedded index.
// Mirrors app.js runAIForStudent fallback path, but offline (no AI endpoint).
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const sandbox = { window: {}, console, setTimeout, clearTimeout,
  // minimal stubs so store.js loads without a browser
  document: { getElementById: () => null },
};
sandbox.window = sandbox; sandbox.global = sandbox;
vm.createContext(sandbox);

// load embedded index + RAG layer (no fetch needed)
vm.runInContext(fs.readFileSync(path.join(__dirname, 'faa_index.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'faaRag.js'), 'utf8'), sandbox);

// load store.js to get buildPerformance + generateFeedback
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'store.js'), 'utf8'), sandbox);

(async () => {
  const FaaRag = sandbox.FaaRag;
  await FaaRag.loadIndex();
  console.log('RAG status:', FaaRag.status());

  // Build a perf object the way the app does (ali-alawiyeh-like weak maneuvers).
  const data = sandbox.buildPerformance
    ? sandbox.buildPerformance(
        { id: 's_ali', name: 'Cadet Ali Alawiyeh' },
        [{
          studentId: 's_ali', studentName: 'Cadet Ali Alawiyeh',
          phaseName: 'CONFINED AREAS', tripNumber: 'S77', date: 1751155200,
          finalGrade: 85.6, overallMifStatus: 'BELOW STANDARD',
          maneuverGrades: [
            { name: 'Low recon', studentGrade: 1, requiredMif: 2, factor: 1.5 },
            { name: 'Oral', studentGrade: 1, requiredMif: 2, factor: 1 },
            { name: 'Pre-flight / Walk-around', studentGrade: 4, requiredMif: 2, factor: 1 },
            { name: 'RADIO COMMUNICATION/ SA', studentGrade: 3, requiredMif: 2, factor: 1 },
          ],
          instructorNotes: 'good trip, needs oral prep; low recon parameters off; confined area high recon not maintained',
        }]
      )
    : null;

  if (!data) { console.log('buildPerformance not exposed; using synthetic data'); }

  // call the now-async offline generator
  const out = await sandbox.generateFeedback(data);
  console.log('\n===== OFFLINE DEBRIEF (with RAG) =====\n');
  console.log(out.slice(0, 1600));
  console.log('\n...[truncated]...\n');
  // assertions
  const cited = /\(FAA-H-8083-25B,? p\.|\(UH-1 IPC,? p\.|\(Robinson FTG,? p\./.test(out);
  const hasRef = /REFERENCE SOURCE MATERIAL/.test(out);
  console.log('\n>>> contains REFERENCE block:', hasRef);
  console.log('>>> contains a manual citation (FAA/UH-1/FTG p.N):', cited);
  process.exit(cited && hasRef ? 0 : 2);
})().catch(e => { console.error('ERR', e); process.exit(1); });
