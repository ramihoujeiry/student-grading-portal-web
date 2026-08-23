// Vite config for test builds — same shape as vite.config.js but without
// production-only plugins, so e2e can build a test-mode bundle if needed.
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src',
  base: '/student-grading-portal-web/',
  build: {
    outDir: '../dist-test',
    emptyOutDir: true,
  },
  define: {
    __TEST_MODE__: true,
  },
});
