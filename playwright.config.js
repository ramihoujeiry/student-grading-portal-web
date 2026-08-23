// @ts-check
// Playwright e2e config for the Student Grading Portal.
// Tests run against a local preview build (`npm run build && npm run preview`)
// so we exercise the real bundled output, not the dev server.
import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.E2E_PORT || 4173;
const BASE_URL = process.env.E2E_BASE_URL || `http://127.0.0.1:${PORT}/`;

export default defineConfig({
  // The smoke suites live directly in tests/ (store.js data layer + the
  // index.html feature surface, both served by tests/serve.mjs).
  testDir: './tests',
  testMatch: /.*\.smoke\.spec\.js$/,
  fullyParallel: false,      // app shares one Firebase backend; keep tests sequential
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  timeout: 30_000,
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // Start the preview server automatically unless an external URL is provided
  ...(process.env.E2E_BASE_URL ? {} : {
    // Serve tests/fixture/ with /src/** aliased to the real repo source, so the
    // suite exercises the authentic store.js module (not the built dist bundle).
    webServer: {
      command: 'node tests/serve.mjs 4173',
      port: Number(PORT),
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  }),
});
