#!/usr/bin/env node
// Microbenchmark: copy gitignored items (cp -RPpc / clonefile) under
// unbounded concurrency vs a small worker-pool cap. Uses the *current* repo's
// gitignored set as the workload. Each iteration copies into a fresh tmp dir
// and removes it afterwards.

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

const execAsync = promisify(exec);
const projectPath = process.cwd();
const ITERS = 3;
const CONCURRENCY = 8;

function shellEscape(str) {
  return `'${str.replace(/'/g, "'\\''")}'`;
}

async function fetchIgnored() {
  const { stdout } = await execAsync(
    'git ls-files --others --ignored --exclude-standard --directory',
    { cwd: projectPath, maxBuffer: 10 * 1024 * 1024 },
  );
  return stdout.split('\n').filter(Boolean);
}

async function copyOne(item, dest) {
  const cleanItem = item.replace(/\/$/, '');
  if (!cleanItem) return;
  const sourceItem = path.join(projectPath, cleanItem);
  const destItem = path.join(dest, cleanItem);
  try {
    const stat = await fs.lstat(sourceItem);
    if (stat.isSymbolicLink()) return;
    await fs.mkdir(path.dirname(destItem), { recursive: true });
    if (stat.isDirectory()) {
      await execAsync(`cp -RPpc ${shellEscape(sourceItem)} ${shellEscape(destItem)}`);
    } else {
      await execAsync(`cp -Ppc ${shellEscape(sourceItem)} ${shellEscape(destItem)}`);
    }
  } catch {
    /* ignore */
  }
}

async function runUnbounded(items, dest) {
  const t0 = performance.now();
  await Promise.all(items.map((item) => copyOne(item, dest)));
  return performance.now() - t0;
}

async function runBounded(items, dest, limit) {
  const t0 = performance.now();
  let cursor = 0;
  const runOne = async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      await copyOne(items[i], dest);
    }
  };
  const runners = [];
  for (let i = 0; i < Math.min(limit, items.length); i++) runners.push(runOne());
  await Promise.all(runners);
  return performance.now() - t0;
}

async function freshTmp() {
  const p = path.join(os.tmpdir(), `ouijit-copy-bench-${process.pid}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(p, { recursive: true });
  return p;
}

const items = await fetchIgnored();
console.log('ignored items:', items.length);

const unbounded = [];
const bounded = [];

// Warm up
const warm = await freshTmp();
await runBounded(items, warm, CONCURRENCY);
await fs.rm(warm, { recursive: true, force: true });

for (let i = 0; i < ITERS; i++) {
  const a = await freshTmp();
  unbounded.push(await runUnbounded(items, a));
  await fs.rm(a, { recursive: true, force: true });

  const b = await freshTmp();
  bounded.push(await runBounded(items, b, CONCURRENCY));
  await fs.rm(b, { recursive: true, force: true });
}

const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
console.log('unbounded ms (avg / each):', avg(unbounded).toFixed(0), unbounded.map(x => x.toFixed(0)).join(' '));
console.log('bounded   ms (avg / each):', avg(bounded).toFixed(0), bounded.map(x => x.toFixed(0)).join(' '));
console.log('change:', ((avg(unbounded) - avg(bounded)) / avg(unbounded) * 100).toFixed(1) + '%');
