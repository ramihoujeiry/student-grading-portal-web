#!/usr/bin/env node
// Kills any process listening on the given port (default 4173, vite preview).
// Usage: node scripts/killport.cjs [port]
import { execSync } from 'node:child_process';
import process from 'node:process';

const port = Number(process.argv[2] || 4173);
try {
  if (process.platform === 'win32') {
    const out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
    const pids = [...new Set(out.split('\n').map(l => l.trim().split(/\s+/).pop()).filter(p => /^\d+$/.test(p)))];
    for (const pid of pids) { try { execSync(`taskkill /PID ${pid} /F`); console.log('killed', pid); } catch {} }
  } else {
    execSync(`lsof -ti tcp:${port} | xargs -r kill -9`);
  }
  console.log('port', port, 'cleared');
} catch (e) {
  console.log('nothing listening on', port);
}
