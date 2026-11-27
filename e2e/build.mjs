/**
 * Builds main, preload, and renderer for E2E tests.
 *
 * Replicates the production-mode build that electron-forge's Vite plugin
 * performs, so the app loads from files (no dev server / no port conflicts).
 */
import { build } from 'vite';
import { builtinModules } from 'node:module';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

const external = [
  'electron',
  'electron/main',
  'electron/common',
  ...builtinModules.map((m) => [m, `node:${m}`]).flat(),
];

// Not `.vite`: electron-forge writes its dev build there on every `npm start`
// (which `npm run capture` runs), and fixtures.ts launches from this one.
const outRoot = '.vite-e2e';
const hashFile = `${outRoot}/inputs.sha256`;
const outputs = [
  `${outRoot}/build/main.cjs`,
  `${outRoot}/build/preload.cjs`,
  `${outRoot}/renderer/main_window/index.html`,
  'dist-cli/ouijit.js',
];

const inputs = [
  'src',
  'index.html',
  'vite.main.config.mts',
  'vite.preload.config.mts',
  'vite.renderer.config.mts',
  'devServerPort.mts',
  'postcss.config.js',
  'tsconfig.json',
  'package.json',
  'package-lock.json',
  'patches',
  'e2e/build.mjs',
  'scripts/build-cli.mjs',
];

function listFiles(entry) {
  if (!fs.existsSync(entry)) return [];
  if (!fs.statSync(entry).isDirectory()) return [entry];
  return fs
    .readdirSync(entry, { recursive: true, withFileTypes: true })
    .filter((dirent) => dirent.isFile() && dirent.name !== '.DS_Store')
    .map((dirent) => path.join(dirent.parentPath, dirent.name));
}

function hashInputs() {
  const hash = createHash('sha256');
  for (const file of inputs.flatMap(listFiles).sort()) {
    hash.update(`${file}\0`);
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

const inputHash = hashInputs();
const upToDate =
  process.env.E2E_FORCE_BUILD !== '1' &&
  outputs.every((file) => fs.existsSync(file)) &&
  fs.existsSync(hashFile) &&
  fs.readFileSync(hashFile, 'utf8').trim() === inputHash;

if (upToDate) {
  console.log(`E2E build up to date (${inputHash.slice(0, 12)}), skipping. Set E2E_FORCE_BUILD=1 to rebuild.`);
  process.exit(0);
}

console.log(
  process.env.E2E_FORCE_BUILD === '1'
    ? 'E2E_FORCE_BUILD=1, rebuilding.'
    : `E2E inputs changed (${inputHash.slice(0, 12)}), rebuilding.`,
);
// Before building, so a build killed partway is redone on the next run.
fs.rmSync(hashFile, { force: true });

await import('../scripts/build-cli.mjs');

// Build main process
await build({
  configFile: 'vite.main.config.mts',
  build: {
    outDir: `${outRoot}/build`,
    emptyOutDir: false,
    lib: {
      entry: 'src/main.ts',
      fileName: () => '[name].cjs',
      formats: ['cjs'],
    },
    rolldownOptions: {
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
  configFile: 'vite.preload.config.mts',
  build: {
    outDir: `${outRoot}/build`,
    emptyOutDir: false,
    lib: {
      entry: 'src/preload.ts',
      fileName: () => '[name].cjs',
      formats: ['cjs'],
    },
    rolldownOptions: {
      external,
    },
    minify: false,
  },
});

// Build renderer (base './' so assets use relative paths for file:// loading)
await build({
  configFile: 'vite.renderer.config.mts',
  root: '.',
  base: './',
  build: {
    outDir: `${outRoot}/renderer/main_window`,
    emptyOutDir: true,
    minify: false,
  },
});

fs.writeFileSync(hashFile, `${inputHash}\n`);
console.log('\nE2E build complete.');
