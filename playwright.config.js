// @ts-check
// Playwright e2e config for the Student Grading Portal.
// Tests run against a local preview build (`npm run build && npm run preview`)
// so we exercise the real bundled output, not the dev server.
import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.E2E_PORT || 4173;
const BASE_URL = process.env.E2E_BASE_URL || `http://localhost:${PORT}/`;

export default defineConfig({
  testDir: './tests/e2e',
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
    webServer: {
      command: 'npm run preview',
      port: Number(PORT),
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  }),
});
