/**
 * Bundle the Ouijit CLI with esbuild.
 * Produces dist-cli/ouijit.js — a single self-contained JS file.
 *
 * The CLI communicates with the running Electron app via HTTP,
 * so it has no native dependencies (no better-sqlite3, no koffi).
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
  logLevel: 'warning',
});

console.log('Built dist-cli/ouijit.js');
