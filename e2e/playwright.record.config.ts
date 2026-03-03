import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'record-demo.ts',
  timeout: 120_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
});
