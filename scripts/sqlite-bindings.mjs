/**
 * Keeps one better-sqlite3 binary per runtime, so vitest (Node) and the e2e
 * suite (Electron) never have to rebuild over each other.
 *
 *   node scripts/sqlite-bindings.mjs [node] [electron]
 *
 * Each binary is cached under node_modules/.cache, keyed by the better-sqlite3
 * version and the runtime's ABI, and built only when missing. Vitest loads the
 * Node copy from there directly. Electron can only load the package's own
 * build/Release, so the Electron copy is installed there on every run.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const packageDir = path.dirname(require.resolve('better-sqlite3/package.json'));
const releaseBinary = path.join(packageDir, 'build', 'Release', 'better_sqlite3.node');

function abiKey(runtime) {
  if (runtime === 'node') return `node-abi${process.versions.modules}`;
  return `electron-${require('electron/package.json').version}`;
}

export function sqliteBindingPath(runtime) {
  const { version } = require('better-sqlite3/package.json');
  const name = `${version}-${abiKey(runtime)}-${process.platform}-${process.arch}.node`;
  return path.join(root, 'node_modules', '.cache', 'better-sqlite3', name);
}

function buildIntoRelease(runtime) {
  if (runtime === 'node') {
    execFileSync('npm', ['rebuild', 'better-sqlite3', '--silent'], { cwd: root, stdio: 'inherit' });
  } else {
    const electronVersion = require('electron/package.json').version;
    execFileSync(
      path.join(root, 'node_modules', '.bin', 'electron-rebuild'),
      ['-v', electronVersion, '-o', 'better-sqlite3', '--force'],
      { cwd: root, stdio: 'inherit' },
    );
  }
}

// A new inode rather than an overwrite: macOS kills a process whose loaded
// binary changes underneath it, which would take down a running dev app.
function replaceFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, `${to}.tmp`);
  fs.renameSync(`${to}.tmp`, to);
}

function ensure(runtime) {
  const cached = sqliteBindingPath(runtime);
  if (!fs.existsSync(cached)) {
    console.log(`Building better-sqlite3 for ${abiKey(runtime)}`);
    buildIntoRelease(runtime);
    replaceFile(releaseBinary, cached);
  }
  if (runtime === 'electron') replaceFile(cached, releaseBinary);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const runtimes = process.argv.length > 2 ? process.argv.slice(2) : ['node', 'electron'];
  const unknown = runtimes.filter((r) => r !== 'node' && r !== 'electron');
  if (unknown.length > 0) throw new Error(`Unknown runtime: ${unknown.join(', ')}`);
  // Node first: building it goes through build/Release, which Electron's copy has to end up in.
  for (const runtime of ['node', 'electron'].filter((r) => runtimes.includes(r))) ensure(runtime);
}
