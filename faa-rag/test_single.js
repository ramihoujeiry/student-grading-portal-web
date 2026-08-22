// Emulates the Evaluations-tab single-eval AI path end-to-end:
//  buildSingleEvalPrompt (now RAG-wired) -> live Pi model.
// Verifies the FAA/FTG block injects and the model cites the manuals.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const HERE = __dirname;

// Load embedded index into a fake window
const sandbox = { window: {}, console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(HERE, 'faa_index.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(HERE, 'faaRag.js'), 'utf8'), sandbox);
const FaaRag = sandbox.FaaRag;

// Load real store.js (defines buildSingleEvalPrompt, getAIConfig, callAIModelWithPrompt)
vm.runInContext(fs.readFileSync(path.join(HERE, '..', 'store.js'), 'utf8'), sandbox);

// provide native fetch in the sandbox context (avoid recursion)
sandbox.fetch = globalThis.fetch.bind(globalThis);

// ihab Navigation-Formation (S68) single-eval shape, below-standard items
const ev = {
  studentName: 'ihab abou ali', aircraft: 'R44-2', phase: 'Navigation-Formation',
  trip: 'S68', date: '08 Jun 2026', instructor: 'Rami Houjeiry', duration: 1.0,
  finalGrade: 81.7, mifStatus: 'BELOW STANDARD',
  grades: [
    { name: 'Pre-flight / Walk-around', grade: 4, req: 3 },
    { name: 'Startup/shutdown', grade: 4, req: 3 },
    { name: 'Time control', grade: 1, req: 2 },
    { name: 'Radio calls', grade: 2, req: 3 },
    { name: 'Airspace surveillance', grade: 2, req: 3 },
    { name: 'VFR approach', grade: 2, req: 3 },
    { name: 'Hover taxi', grade: 3, req: 3 },
  ],
  below: [
    { name: 'Time control', grade: 1, req: 2 },
    { name: 'Radio calls', grade: 2, req: 3 },
    { name: 'Airspace surveillance', grade: 2, req: 3 },
    { name: 'VFR approach', grade: 2, req: 3 },
  ],
  notes: 'Could have prepared better; flew without a time-control device.'
};

(async () => {
  const prompt = await sandbox.buildSingleEvalPrompt(ev);
  const hasBlock = /REFERENCE SOURCE MATERIAL/.test(prompt.user);
  console.log('Single-eval prompt has FAA/FTG block?', hasBlock);
  console.log('--- injected reference excerpts ---');
  const m = prompt.user.match(/REFERENCE — [^\n]+/g) || [];
  m.slice(0, 6).forEach(x => console.log('  ' + x.slice(0, 80)));
  if (!hasBlock) { console.log('NO BLOCK — aborting live call'); return; }
  console.log('\n--- calling live model (single-eval) ---');
  const cfg = await sandbox.getAIConfig();
  if (!cfg) { console.log('no AI config (Pi offline?) — skip live'); return; }
  const text = await sandbox.callAIModelWithPrompt(prompt, cfg);
  console.log('Model replied in', '---');
  console.log(text.slice(0, 900));
})();
