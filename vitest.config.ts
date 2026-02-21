import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          setupFiles: ['./src/__tests__/setup.ts'],
          include: ['src/__tests__/*.test.ts'],
          exclude: ['e2e/**', 'node_modules/**'],
          isolate: true,
        },
      },
      {
        test: {
          name: 'integration',
          setupFiles: ['./src/__tests__/integration/setup.ts'],
          include: ['src/__tests__/integration/**/*.test.ts'],
          exclude: ['e2e/**', 'node_modules/**'],
          isolate: true,
        },
      },
    ],
  },
});
