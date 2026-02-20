import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.test.ts',
  timeout: 30_000,
  retries: 0,
  workers: 1, // Electron tests must run serially
  reporter: [['list']],
  outputDir: './results',
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
});
