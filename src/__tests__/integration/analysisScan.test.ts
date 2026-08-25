/**
 * The analysis scan against a real git repo: the cache is the part a unit test
 * can't reach, and the overview is the whole pipeline at once.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  scanProject,
  invalidateAnalysis,
  getAnalysisOverview,
  getDiffSignals,
  type ProjectAnalysis,
} from '../../analysis/service';
import { pairKey } from '../../analysis/accumulate';
import { monthIndex } from '../../analysis/types';
import { setGlobalSetting, _resetCacheForTesting } from '../../db';
import { experimentalStorageKey } from '../../experimentalFlags';
import { invalidateMainBranchCache } from '../../git';

let tmpDir: string;
let repoDir: string;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repoDir, encoding: 'utf8' }).trim();
}

async function write(file: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(path.join(repoDir, file)), { recursive: true });
  await fs.writeFile(path.join(repoDir, file), contents);
}

async function commitAll(message: string, author = 'Alice <alice@x>'): Promise<void> {
  git('add', '-A');
  git('commit', '-m', message, `--author=${author}`);
}

/** A rebased commit: committed now, but written long before the window. */
async function commitAllDatedLongAgo(message: string): Promise<void> {
  git('add', '-A');
  execFileSync('git', ['commit', '-m', message, '--author=Alice <alice@x>'], {
    cwd: repoDir,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_DATE: '2015-06-01T00:00:00Z' },
  });
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ouijit-analysis-'));
  repoDir = path.join(tmpDir, 'project');
  await fs.mkdir(repoDir, { recursive: true });

  git('init', '--initial-branch=main');
  git('config', 'user.email', 'test@test.com');
  git('config', 'user.name', 'Test');

  await write('a.ts', 'let a = 1;\n');
  await write('b.ts', 'let b = 1;\n');
  await commitAll('first');

  await write('a.ts', 'let a = 2;\nif (a) {\n    a++;\n}\n');
  await write('b.ts', 'let b = 2;\n');
  await commitAll('second');

  await write('a.ts', 'let a = 3;\nif (a) {\n    a++;\n}\n');
  await commitAll('third', 'Bob <bob@x>');
});

afterEach(async () => {
  invalidateAnalysis();
  invalidateMainBranchCache();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function freshScan(): Promise<ProjectAnalysis> {
  invalidateAnalysis(repoDir);
  const analysis = await scanProject(repoDir);
  expect(analysis).not.toBeNull();
  return analysis!;
}

describe('the analysis cache across scans', () => {
  test('builds the model from history and reads complexity from the tree', async () => {
    const analysis = await freshScan();

    expect(analysis.lastSha).toBe(git('rev-parse', 'main'));
    expect(analysis.model.commitCount).toBe(3);

    const a = analysis.model.files.get('a.ts');
    expect(a?.commits).toBe(3);
    expect(analysis.model.files.get('b.ts')?.commits).toBe(2);
    expect(analysis.model.couplings.get(pairKey('a.ts', 'b.ts'))).toBe(2);

    const authors = analysis.model.authors.get('a.ts');
    expect(authors?.get('alice@x')?.commits).toBe(2);
    expect(authors?.get('bob@x')?.name).toBe('Bob');

    // Working-tree read: a.ts has one indented line at depth 1.
    expect(analysis.complexity.get('a.ts')).toEqual({ loc: 4, indentTotal: 1, indentMax: 1 });
  });

  test('an advanced tip folds incrementally to what a cold scan builds', async () => {
    const before = await scanProject(repoDir);

    // An exact rename, so git's rename detection reports it as one.
    await fs.mkdir(path.join(repoDir, 'src'), { recursive: true });
    git('mv', 'b.ts', 'src/renamed.ts');
    await commitAll('rename b');
    await write('src/renamed.ts', 'let b = 4;\n');
    await write('a.ts', 'let a = 5;\n');
    await commitAll('touch both');

    const incremental = await scanProject(repoDir);
    expect(incremental).toBe(before); // same object, folded in place
    const cold = await freshScan();

    const byPath = <T,>(entries: Iterable<[string, T]>) =>
      [...entries].sort((a, b) => a[0].localeCompare(b[0]));

    expect(incremental!.lastSha).toBe(cold.lastSha);
    expect(incremental!.model.commitCount).toBe(cold.model.commitCount);
    expect(byPath(incremental!.model.files)).toEqual(byPath(cold.model.files));
    expect(byPath(incremental!.model.couplings)).toEqual(byPath(cold.model.couplings));
    // Complexity is carried forward for files the fold did not touch, so an
    // edited file holding a stale reading would show up only here.
    expect(byPath(incremental!.complexity)).toEqual(byPath(cold.complexity));
    expect(byPath(incremental!.scores)).toEqual(byPath(cold.scores));
  });

  test('a model built in an earlier month is rebuilt rather than folded onto', async () => {
    const before = await scanProject(repoDir);
    // Folding only ever adds, so a model carried across a month boundary could
    // never lose the months that had left the window.
    before!.builtInMonth -= 1;

    await write('c.ts', 'let c = 1;\n');
    await commitAll('later');

    const after = await scanProject(repoDir);
    expect(after).not.toBe(before);
    expect(after?.builtInMonth).toBe(monthIndex(Date.now() / 1000));
    expect(after?.model.commitCount).toBe(4);
  });

  test('a rewritten history falls back to a full rescan', async () => {
    const before = await scanProject(repoDir);
    expect(before?.model.commitCount).toBe(3);

    git('reset', '--hard', 'HEAD~1');
    await write('c.ts', 'let c = 1;\n');
    await commitAll('replaced history');

    const after = await scanProject(repoDir);
    expect(after).not.toBe(before);
    expect(after?.model.commitCount).toBe(3);
    expect(after?.model.files.has('c.ts')).toBe(true);
    // The commit that only existed on the abandoned tip is gone.
    expect(after?.model.authors.get('a.ts')?.has('bob@x')).toBe(false);
  });
});

describe('the project read as a whole', () => {
  // The flag gate reads globalSettings, so the reads need a database behind them.
  beforeEach(async () => {
    _resetCacheForTesting();
    await setGlobalSetting(experimentalStorageKey(repoDir), JSON.stringify({ analysis: true }));
  });

  test('reads the project as hotspots, modules and coupled pairs', async () => {
    // Hotspot tiers are percentile ranks, so a handful of files is not a
    // population: these give the ranked ones something to be ranked against.
    for (let i = 0; i < 12; i++) await write(`misc/f${i}.ts`, `export const f = ${i};\n`);
    await commitAll('filler');

    // A directory deep enough to prove the tree rolls up, and busy enough to rank.
    for (let i = 0; i < 8; i++) {
      await write('src/core/engine.ts', nested(i, 40));
      if (i % 2 === 0) await write('src/core/helper.ts', `export const h = ${i};\n`);
      if (i % 3 === 0) await write('src/ui/view.ts', `export const v = ${i};\n`);
      await commitAll(`work ${i}`);
    }
    invalidateAnalysis(repoDir);

    const overview = await getAnalysisOverview(repoDir);
    expect(overview).not.toBeNull();

    const engine = overview!.hotspots.find((h) => h.path === 'src/core/engine.ts');
    expect(engine?.signal.tier).toBe('hot');
    expect(engine?.signal.commits).toBe(8);
    expect(engine?.signal.authorCount).toBe(1);
    // Everything landed this month, so the whole window sits in the tail.
    expect(engine?.signal.trend.recent).toBe(8);
    expect(engine?.partner?.path).toBe('src/core/helper.ts');

    const src = overview!.modules.find((m) => m.path === 'src');
    expect(src?.commits).toBe(8);
    expect(src?.children.map((c) => c.path).sort()).toEqual(['src/core', 'src/ui']);
    expect(src?.children.find((c) => c.path === 'src/core')?.hotspots).toBeGreaterThan(0);
    expect(src?.children.find((c) => c.path === 'src/ui')?.commits).toBe(3);

    expect(overview!.moduleCouplings.some((p) => p.a === 'src/core' && p.b === 'src/ui')).toBe(true);
    expect(overview!.couplings.some((p) => p.a === 'src/core/engine.ts' && p.b === 'src/core/helper.ts')).toBe(true);
    expect(overview!.monthly.reduce((a, b) => a + b, 0)).toBe(overview!.commitCount);
  });

  test('a commit written outside the window is left out, however recently it landed', async () => {
    await write('ancient.ts', 'let old = 1;\n');
    await commitAllDatedLongAgo('rebased from long ago');
    invalidateAnalysis(repoDir);

    const overview = await getAnalysisOverview(repoDir);
    expect(overview!.commitCount).toBe(3);
    // What counts has to be what plots, or the totals disagree with the chart.
    expect(overview!.monthly.reduce((a, b) => a + b, 0)).toBe(overview!.commitCount);
    expect(await getDiffSignals(repoDir, ['ancient.ts'])).toEqual({});
  });

  test('a lockfile never runs hot, but is still named as a file left behind', async () => {
    for (let i = 0; i < 6; i++) {
      await write('package.json', `{ "version": "0.0.${i}" }\n`);
      await write('package-lock.json', nested(i, 60));
      await commitAll(`bump ${i}`);
    }
    invalidateAnalysis(repoDir);

    const signals = await getDiffSignals(repoDir, ['package.json']);
    // Deeply nested and changed constantly, so complexity alone would rank it
    // top; it is left unread instead, which is what keeps it quiet.
    const lock = await getDiffSignals(repoDir, ['package-lock.json']);
    expect(lock!['package-lock.json'].signal).toMatchObject({ tier: 'quiet', cxRank: null });
    // Coupling still sees it: "you changed the manifest but not the lockfile".
    expect(signals!['package.json'].missing).toEqual(['package-lock.json']);
  });

  test('the flag being off is indistinguishable from having no analysis', async () => {
    await setGlobalSetting(experimentalStorageKey(repoDir), JSON.stringify({ analysis: false }));
    expect(await getAnalysisOverview(repoDir)).toBeNull();
    expect(await getDiffSignals(repoDir, ['a.ts'])).toBeNull();
  });
});

describe('signals for one diff', () => {
  beforeEach(async () => {
    _resetCacheForTesting();
    await setGlobalSetting(experimentalStorageKey(repoDir), JSON.stringify({ analysis: true }));

    // a.ts and b.ts move together often enough to couple; c.ts stays apart.
    for (let i = 0; i < 4; i++) {
      await write('a.ts', `let a = ${i};\n`);
      await write('b.ts', `let b = ${i};\n`);
      await commitAll(`pair ${i}`);
    }
    await write('c.ts', 'let c = 1;\n');
    await commitAll('alone');
    invalidateAnalysis(repoDir);
  });

  test('names a coupled file the diff leaves out, and stays quiet once it is in', async () => {
    const without = await getDiffSignals(repoDir, ['a.ts']);
    expect(without?.['a.ts'].missing).toEqual(['b.ts']);
    expect(without?.['a.ts'].signal.commits).toBe(7);

    // Both sides on screen: the reader can see the pair for themselves.
    const withBoth = await getDiffSignals(repoDir, ['a.ts', 'b.ts']);
    expect(withBoth?.['a.ts'].missing).toEqual([]);
    expect(withBoth?.['b.ts'].missing).toEqual([]);

    // A path with no history in the window is absent rather than empty.
    expect(await getDiffSignals(repoDir, ['nothing.ts'])).toEqual({});
  });
});

/** A file whose nesting makes it complex enough to rank as a hotspot. */
function nested(seed: number, lines: number): string {
  let text = `export function run${seed}() {\n`;
  for (let i = 0; i < lines; i++) text += ' '.repeat(4 * (2 + (i % 4))) + `step(${i});\n`;
  return text + '}\n';
}
