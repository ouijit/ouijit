/**
 * Builds main, preload, and renderer for E2E tests.
 *
 * Replicates the production-mode build that electron-forge's Vite plugin
 * performs, so the app loads from files (no dev server / no port conflicts).
 */
import { build } from 'vite';
import { builtinModules } from 'node:module';

const external = [
  'electron',
  'electron/main',
  'electron/common',
  ...builtinModules.map((m) => [m, `node:${m}`]).flat(),
];

// Build main process
await build({
  configFile: 'vite.main.config.ts',
  build: {
    outDir: '.vite/build',
    emptyOutDir: false,
    lib: {
      entry: 'src/main.ts',
      fileName: () => '[name].js',
      formats: ['cjs'],
    },
    rollupOptions: {
      external: [...external, 'node-pty', 'koffi'],
    },
    minify: false,
    copyPublicDir: false,
  },
  define: {
    MAIN_WINDOW_VITE_DEV_SERVER_URL: 'undefined',
    MAIN_WINDOW_VITE_NAME: JSON.stringify('main_window'),
  },
  resolve: {
    conditions: ['node'],
    mainFields: ['module', 'jsnext:main', 'jsnext'],
  },
});

// Build preload
await build({
  configFile: 'vite.preload.config.ts',
  build: {
    outDir: '.vite/build',
    emptyOutDir: false,
    lib: {
      entry: 'src/preload.ts',
      fileName: () => '[name].js',
      formats: ['cjs'],
    },
    rollupOptions: {
      external,
    },
    minify: false,
  },
});

// Build renderer (base './' so assets use relative paths for file:// loading)
await build({
  configFile: 'vite.renderer.config.ts',
  root: '.',
  base: './',
  build: {
    outDir: '.vite/renderer/main_window',
    emptyOutDir: true,
    minify: false,
  },
});

console.log('\nE2E build complete.');
