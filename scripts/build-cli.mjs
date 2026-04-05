/**
 * Bundle the Ouijit CLI with esbuild.
 * Produces dist-cli/ouijit.js + installs native deps for system Node.
 *
 * The main project's node_modules has better-sqlite3 compiled for Electron's
 * Node ABI. The CLI runs with system Node, so it needs its own copies.
 */

import { build } from 'esbuild';
import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// 1. Bundle JS
await build({
  entryPoints: ['src/cli/index.ts'],
  outfile: 'dist-cli/ouijit.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  banner: { js: '#!/usr/bin/env node' },
  // Native addons can't be bundled — resolved from dist-cli/node_modules/ at runtime
  external: ['better-sqlite3', 'koffi'],
  logLevel: 'warning',
});

console.log('Built dist-cli/ouijit.js');

// 2. Install native deps for system Node (skip if already present)
const cliModules = join('dist-cli', 'node_modules');
const sqlitePkg = join(cliModules, 'better-sqlite3', 'package.json');

if (!existsSync(sqlitePkg)) {
  console.log('Installing native deps for system Node...');
  mkdirSync(cliModules, { recursive: true });
  execSync('npm install better-sqlite3 koffi --no-save --no-package-lock', {
    cwd: 'dist-cli',
    stdio: 'inherit',
  });
  console.log('Native deps installed');
} else {
  console.log('Native deps already installed (rm dist-cli/node_modules to rebuild)');
}
