import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./src/__tests__/setup.ts'],
    isolate: true,
    exclude: ['e2e/**', 'node_modules/**'],
  },
});
