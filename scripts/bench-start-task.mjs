#!/usr/bin/env node
// Microbenchmark: simulate the parallelizable git/fs portion of startTask
// against the *current repo* and compare a serial pipeline (old order) to a
// parallel one (new order). Does NOT touch the SQLite DB or copy ignored
// files — just the git/fs prelude. Run from the repo root.

import { execFile, exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const projectPath = process.cwd();
const baseDir = path.join(os.tmpdir(), `ouijit-bench-${process.pid}`);
const ITERS = 5;

async function probePath(taskNumber) {
  await fs.mkdir(baseDir, { recursive: true });
  let p = path.join(baseDir, `T-${taskNumber}`);
  let n = taskNumber;
  while (await fs.access(p).then(() => true, () => false)) {
    n++;
    p = path.join(baseDir, `T-${n}`);
  }
  return p;
}

async function fetchIgnored() {
  const { stdout } = await execAsync(
    'git ls-files --others --ignored --exclude-standard --directory',
    { cwd: projectPath, maxBuffer: 10 * 1024 * 1024 },
  );
  return stdout.split('\n').filter(Boolean);
}

async function serialPrelude(branch) {
  const t0 = performance.now();
  await execAsync('git rev-parse HEAD', { cwd: projectPath }).then(() => true, () => false);
  await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: projectPath }).catch(() => undefined);
  await fs.mkdir(baseDir, { recursive: true });
  await probePath(1000 + Math.random() * 1000 | 0);
  await execAsync('git worktree prune', { cwd: projectPath });
  await execFileAsync('git', ['rev-parse', '--verify', branch], { cwd: projectPath }).then(() => true, () => false);
  await fetchIgnored();
  return performance.now() - t0;
}

async function parallelPrelude(branch) {
  const t0 = performance.now();
  const head = execAsync('git rev-parse HEAD', { cwd: projectPath }).then(() => true, () => false);
  const branchHead = execAsync('git rev-parse --abbrev-ref HEAD', { cwd: projectPath }).catch(() => undefined);
  const mkdir = fs.mkdir(baseDir, { recursive: true });
  const prune = execAsync('git worktree prune', { cwd: projectPath });
  const branchExists = execFileAsync('git', ['rev-parse', '--verify', branch], { cwd: projectPath }).then(() => true, () => false);
  const ignored = fetchIgnored();
  await mkdir;
  await probePath(2000 + Math.random() * 1000 | 0);
  await Promise.all([head, branchHead, prune, branchExists, ignored]);
  return performance.now() - t0;
}

const branch = `bench-nonexistent-${Date.now()}`;

const serial = [];
const parallel = [];
for (let i = 0; i < ITERS; i++) {
  serial.push(await serialPrelude(branch));
  parallel.push(await parallelPrelude(branch));
}

const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

console.log('iters:', ITERS);
console.log('serial   ms (avg / each):', avg(serial).toFixed(1), serial.map(x => x.toFixed(1)).join(' '));
console.log('parallel ms (avg / each):', avg(parallel).toFixed(1), parallel.map(x => x.toFixed(1)).join(' '));
console.log('speedup:', (avg(serial) / avg(parallel)).toFixed(2) + 'x');

await fs.rm(baseDir, { recursive: true, force: true });
