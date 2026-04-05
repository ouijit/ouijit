/**
 * Bundle the Ouijit CLI with esbuild.
 * Produces dist-cli/ouijit.js — a single Node.js CJS bundle.
 */

import { build } from 'esbuild';

await build({
  entryPoints: ['src/cli/index.ts'],
  outfile: 'dist-cli/ouijit.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  banner: { js: '#!/usr/bin/env node' },
  // Native addons can't be bundled
  external: ['better-sqlite3', 'koffi'],
  // Silence warnings about require() in node_modules
  logLevel: 'warning',
});

console.log('Built dist-cli/ouijit.js');
