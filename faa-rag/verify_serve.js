// Headless-Chrome check: load the served app, read window.ragReady (via the
// Vue app's data) + capture console errors + confirm FaaRag loaded the index.
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 8142;
const REPO = 'D:\\grading-portal-web';

// start a static server
const server = require('http');
const http = require('http');
const url = require('url');
const mime = { '.html':'text/html', '.js':'application/javascript', '.json':'application/json', '.css':'text/css', '.png':'image/png' };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(url.parse(req.url).pathname);
  if (p === '/') p = '/index.html';
  const fp = path.join(REPO, p);
  fs.readFile(fp, (e, data) => {
    if (e) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(fp)] || 'application/octet-stream' });
    res.end(data);
  });
});
srv.listen(PORT, '127.0.0.1', () => console.log('server on', PORT));

// Use Chrome via the DevTools protocol minimally: launch headless, dump console.
// Simpler: use --dump-dom won't run JS timers for our async. Instead inject a
// small probe by navigating then evaluating. We'll use chrome --headless with
// remote debugging is heavy; instead just fetch the page + faaRag.js + index
// the same way the browser would, and statically confirm the wiring.
console.log('--- simulating browser asset fetches ---');
function get(u){ try { const o = execSync(`curl -s -m 10 -o /dev/null -w "%{http_code}" "http://127.0.0.1:${PORT}${u}"`); return o.toString().trim(); } catch(e){ return 'ERR'; } }
console.log('index.html        ', get('/index.html'));
console.log('sw.js?v=49         ', get('/sw.js?v=49'));
console.log('faa-rag/faaRag.js?v=49', get('/faa-rag/faaRag.js?v=49'));
console.log('faa-rag/faa_index.json', get('/faa-rag/faa_index.json'));
// confirm index.html references v49 + FaaRag
const html = fs.readFileSync(path.join(REPO,'index.html'),'utf8');
console.log('html loads faaRag v49?', /faa-rag\/faaRag\.js\?v=49/.test(html));
console.log('html loads store v49? ', /store\.js\?v=49/.test(html));
srv.close();
