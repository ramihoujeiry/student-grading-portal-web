// Simulate the app's buildFaaContext path against a sample index to prove the
// matcher + prompt assembly works (independent of the slow full-PDF parse).
const fs = require('fs');
const path = require('path');
// load faaRag.js in a fake window/global
global.window = global;
require('./faaRag.js');
const FaaRag = global.FaaRag;

// point loadIndex at the sample by monkey-patching fetch
global.fetch = async (url) => ({ ok: true, json: async () => JSON.parse(fs.readFileSync(path.join(__dirname, 'faa_index.sample.json'), 'utf8')) });

// A sample buildPerformance() output for a cadet weak on hover + autorotation
const fakeData = {
  weakManeuvers: [
    { name: 'Hover (translational)', avgGrade: 60, requiredMif: 70, trend: 'DECLINING' },
    { name: 'Emergency - auto-rotation', avgGrade: 1, requiredMif: 0, trend: 'FLAT' }
  ]
};

(async () => {
  const ctx = await FaaRag.buildFaaContext(fakeData);
  console.log('=== FAA CONTEXT INJECTED INTO PROMPT ===');
  console.log(ctx);
  console.log('=== length:', ctx.length, 'chars ===');
})();
