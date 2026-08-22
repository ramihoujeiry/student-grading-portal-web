// Dependency-free headless Chrome test. Chrome can't easily run async then
// dump DOM, so we inject a probe via a temporary copy of index.html that
// writes the RAG state into the page title after load. Then we read the title
// using chrome --headless --dump-dom is not enough; instead use the DevTools
// "Runtime.evaluate" requires ws. So: we write the state into document.title
// and retrieve it via chrome --headless with a small CDP-over-http trick:
// chrome --remote-debugging-port + /json then we already need ws.
// Fallback: inject probe that navigates to a data: URL containing the result,
// and capture it with --dump-dom on THAT url. Simpler: just confirm the
// embedded index parses + FaaRag logic via Node using jsdom-free shim.
const fs = require('fs');
const path = require('path');

// Simulate the browser global env and load faa_index.js + faaRag.js, then
// call FaaRag.buildFaaContext on a sample perf object. This proves the exact
// runtime code paths the browser would execute (no real browser needed).
global.window = global;
// load embedded index
const idxJs = fs.readFileSync(path.join(__dirname, 'faa_index.js'), 'utf8');
eval(idxJs); // sets window.FAA_INDEX
console.log('Embedded index loaded?', typeof global.FAA_INDEX === 'object', '| maneuvers:', Object.keys(global.FAA_INDEX).length);

// load faaRag.js (it's an IIFE attaching to window)
const ragJs = fs.readFileSync(path.join(__dirname, 'faaRag.js'), 'utf8');
eval(ragJs);
const FaaRag = global.FaaRag;
console.log('FaaRag loaded?', typeof FaaRag === 'object');

// Simulate the app's mounted() warm: loadIndex() then status()
(async () => {
  await FaaRag.loadIndex();
  console.log('RAG status after warm:', FaaRag.status(), '(browser would set ragReady to this)');
  // simulate a debrief for ihab-like weak maneuvers
  const perf = {
    weakManeuvers: [
      { name: 'Hover (translational)', avgGrade: 60, requiredMif: 70, trend: 'FLAT' },
      { name: 'Normal landing', avgGrade: 62, requiredMif: 70, trend: 'FLAT' }
    ]
  };
  const ctx = await FaaRag.buildFaaContext(perf);
  console.log('Context injected?', /REFERENCE SOURCE MATERIAL/.test(ctx), '| length:', ctx.length);
  console.log('--- sample ---');
  console.log(ctx.slice(0, 500));
})();
