// Real headless-Chrome test: launch Chrome, load the served app, wait for the
// Vue app to mount + FaaRag to load the embedded index, then read window state
// and capture console errors. This is the definitive "does it actually work
// in a browser" check.
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 8143;
const REPO = 'D:\\grading-portal-web';
const mime = { '.html':'text/html', '.js':'application/javascript', '.json':'application/json', '.css':'text/css', '.png':'image/png' };

const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(url.parse(req.url).pathname);
  if (p === '/') p = '/index.html';
  fs.readFile(path.join(REPO, p), (e, data) => {
    if (e) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(p)] || 'application/octet-stream' });
    res.end(data);
  });
});

srv.listen(PORT, '127.0.0.1', async () => {
  const userData = fs.mkdtempSync('C:\\Users\\USER\\AppData\\Local\\Temp\\chr-');
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=9222',
    '--user-data-dir=' + userData,
    `http://127.0.0.1:${PORT}/index.html`
  ], { stdio: 'ignore' });

  // give Chrome a moment to boot the debug endpoint
  await new Promise(r => setTimeout(r, 2500));
  const httpGet = (u) => new Promise((res) => {
    http.get(u, (r) => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(d)); }).on('error',()=>res(''));
  });
  const list = JSON.parse(await httpGet('http://127.0.0.1:9222/json'));
  const target = list.find(t => t.type === 'page');
  const wsUrl = target.webSocketDebuggerUrl;

  // Minimal WS client
  const WebSocket = (() => { try { return require('ws'); } catch(e){ return null; } })();
  if (!WebSocket) { console.log('NO_WS_MODULE'); chrome.kill(); srv.close(); return; }
  const ws = new WebSocket(wsUrl);
  let buf = '';
  const send = (o) => ws.send(JSON.stringify(o));
  let id = 0;
  const waitResult = (rid) => new Promise((res) => {
    const h = (m) => { const j=JSON.parse(m); if(j.id===rid){ ws.off('message',h); res(j.result); } };
    ws.on('message', h);
  });
  ws.on('open', async () => {
    // enable Runtime + Log
    send({ id: ++id, method: 'Runtime.enable' });
    send({ id: ++id, method: 'Log.enable' });
    // wait for app to mount + FaaRag to warm (mounted() runs on load)
    await new Promise(r => setTimeout(r, 4000));
    // evaluate window state
    send({ id: ++id, method: 'Runtime.evaluate', params: { expression: 'JSON.stringify({ hasFaaRag: typeof FaaRag, hasIndex: typeof window.FAA_INDEX, keys: window.FAA_INDEX?Object.keys(window.FAA_INDEX).length:-1, app: (window.app && window.app.ragReady!==undefined)?window.app.ragReady:"n/a" })' } });
    const r1 = await waitResult(id);
    console.log('WINDOW STATE:', r1.result && r1.result.value);
    // Read console/log messages we captured
    console.log('CONSOLE/LOG errors seen:', buf.slice(0, 600));
    ws.close(); chrome.kill(); srv.close();
  });
  ws.on('message', (m) => { buf += m + '\n'; });
  await new Promise(r => setTimeout(r, 9000));
  try { chrome.kill(); } catch(e){}
  srv.close();
});
