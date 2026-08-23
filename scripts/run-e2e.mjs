#!/usr/bin/env node
// Runs the full e2e flow:
//   1. build the app (production bundle)
//   2. start `vite preview` (Playwright's webServer can also do this, but this
//      script gives a single entry point for CI / manual runs)
//   3. run playwright tests
// Usage: node scripts/run-e2e.mjs   (or: npm run test:e2e)
import { spawnSync } from 'node:child_process';
import process from 'node:process';

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run('npx', ['vite', 'build']);
run('npx', ['playwright', 'test']);
