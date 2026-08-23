// Minimal static file server for the Playwright smoke fixture.
// Usage: node tests/serve.mjs [port] [rootDir]
// Serves the fixture dir at "/" with correct MIME types so ES modules +
// importmaps load, AND aliases "/src/**" to the REAL repository source
// (D:/grading-portal-web/src) so the suite exercises the authentic store.js
// module — not a duplicated copy that can drift.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.argv[2] || process.env.PORT || 5179);
const repoRoot = normalize(join(fileURLToPath(import.meta.url), '..', '..'));
const fixtureRoot = normalize(
  process.argv[3] || join(fileURLToPath(import.meta.url), '..', 'fixture')
);
const srcRoot = join(repoRoot, 'src');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

async function sendFile(res, filePath) {
  const body = await readFile(filePath);
  res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
  res.end(body);
}


async function sendText(res, text) {
  res.writeHead(200, { 'Content-Type': MIME['.html'] });
  res.end(text);
}

const server = http.createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';

    // Alias /src/** -> real repository source (live parity: no duplicated copy).
    // URL paths always use forward slashes, regardless of OS.
    if (urlPath.startsWith('/src/') || urlPath === '/src') {
      const rel = urlPath.slice(4).replace(/^\/+/, '') || 'index.html';
      const filePath = normalize(join(srcRoot, rel));
      if (!filePath.startsWith(srcRoot)) { res.writeHead(403); res.end('forbidden'); return; }
      const info = await stat(filePath).catch(() => null);
      if (!info || !info.isFile()) { res.writeHead(404); res.end('not found'); return; }
      await sendFile(res, filePath);
      return;
    }


    // Live-parity app fixture: /app.html serves tests/fixture/app-fixture.html
    // with the REAL src/index.html body injected at the APP_TEMPLATE marker,
    // so Playwright exercises the authentic in-DOM Vue template + app.js.
    if (urlPath === '/app.html') {
      const tpl = await readFile(join(fixtureRoot, 'app-fixture.html'), 'utf8');
      let srcHtml = await readFile(join(srcRoot, 'index.html'), 'utf8');
      // Extract everything between <body> and </body>.
      const m = srcHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      let body = m ? m[1] : '';
      // Drop the bundler entry (the fixture mounts app.js itself).
      body = body.replace(/<script[^>]*main\.js[^>]*><\/script>/i, '');
      await sendText(res, tpl.replace('<!-- APP_TEMPLATE -->', body));
      return;
    }

    // Otherwise serve from the fixture root.
    const filePath = normalize(join(fixtureRoot, urlPath));
    if (!filePath.startsWith(fixtureRoot)) { res.writeHead(403); res.end('forbidden'); return; }
    const info = await stat(filePath).catch(() => null);
    if (!info || !info.isFile()) { res.writeHead(404); res.end('not found'); return; }
    await sendFile(res, filePath);
  } catch (e) {
    res.writeHead(500); res.end(String(e && e.message || e));
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`fixture server listening on http://127.0.0.1:${port}/ (src aliased to ${srcRoot})`);
});
