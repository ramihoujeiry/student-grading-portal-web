// End-to-end test: load the REAL store.js functions (buildPerformance, buildAIPrompt,
// callAIModel, getAIConfig) and run the live AI generator for seed cadet "Cadet Aoun"
// against the real Pi proxy, WITH the real FAA/UH-1 RAG index attached.
// Proves the manual-grounded prompt reaches the live model.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// --- browser shims ---
global.window = global;
global.document = { getElementById: () => null };
global.firebase = { initializeApp(){}, auth(){return {onAuthStateChanged(){return ()=>{}}}}, firestore(){return {}} };
global.FIREBASE_CONFIG = undefined; global.FIREBASE_READY = false;

// fetch into the vm context (Node 24 global fetch)
const fetchImpl = global.fetch || require('undici').fetch;

// Load the REAL faaRag.js so buildFaaContext works exactly as in the browser.
// It calls fetch('faa-rag/faa_index.json'); we shim fetch to read the local file.
const faaRagPath = path.join(__dirname, 'faaRag.js');
const faaRagCode = fs.readFileSync(faaRagPath, 'utf8');

const ctx = {
  fetch: async (url) => {
    // resolve faa-rag/faa_index.json relative to repo root
    const rel = String(url).replace(/^.*faa-rag\//, '');
    const fp = path.join(__dirname, rel);
    const txt = fs.readFileSync(fp, 'utf8');
    return { ok: true, json: async () => JSON.parse(txt) };
  },
  console,
};
vm.createContext(ctx);
vm.runInContext(faaRagCode + '\n;this.FaaRag = FaaRag;', ctx);
const FaaRag = ctx.FaaRag;

// Now load store.js + seed.js in a context that has FaaRag + fetch
const storeCtx = { FaaRag, fetch: fetchImpl, console, window: global };
vm.createContext(storeCtx);
const storeCode = fs.readFileSync(path.join(__dirname, '..', 'store.js'), 'utf8');
const seedCode = fs.readFileSync(path.join(__dirname, '..', 'seed.js'), 'utf8');
vm.runInContext(storeCode + '\n' + seedCode + '\n;this.__exports={buildPerformance,buildAIPrompt,callAIModel,getAIConfig,SEED};', storeCtx);

const { buildPerformance, buildAIPrompt, callAIModel, getAIConfig, SEED } = storeCtx.__exports;

const aoun = SEED.students.find(s => s.name === 'Cadet Aoun');
const evals = SEED.evaluations.filter(e => e.studentId === aoun.id);

(async () => {
  const data = buildPerformance(aoun, evals);
  console.log('Built performance for', aoun.name, '| evals:', evals.length,
    '| weak:', (data.weakManeuvers||[]).map(w=>w.name).join(', '));
  const cfg = await getAIConfig();
  console.log('AI cfg endpoint:', cfg && cfg.endpoint, '| model:', cfg && cfg.model);

  const prompt = await buildAIPrompt(data);
  console.log('FAA/UH-1 block present in prompt?', /REFERENCE SOURCE MATERIAL/.test(prompt.user));
  const m = prompt.user.match(/REFERENCE SOURCE MATERIAL[\s\S]*?END REFERENCE/);
  if (m) console.log('\n--- injected reference block (excerpt) ---\n' + m[0].slice(0, 900));

  console.log('\n=== CALLING LIVE PI AI GENERATOR ===');
  const t0 = Date.now();
  const text = await callAIModel(data, cfg);
  console.log('Model replied in', ((Date.now()-t0)/1000).toFixed(1), 's:\n');
  console.log(text);
})().catch(e => { console.error('TEST ERROR:', e.message); process.exit(1); });
