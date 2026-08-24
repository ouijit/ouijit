/**
 * The analysis scan against a real git repo.
 *
 * The cache is the part a unit test can't reach: a scan must survive the
 * app's lifetime — fold only the new commits when the tip advances, and
 * start over when history is rewritten under it — and both paths must land
 * on the same model a cold scan produces.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';
import { scanProject, invalidateAnalysis, type ProjectAnalysis } from '../../analysis/service';
import { pairKey } from '../../analysis/accumulate';
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

describe('scanProject', () => {
  test('builds the model from history and reads complexity from the tree', async () => {
    const analysis = await freshScan();

    expect(analysis.ref).toBe('main');
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

    expect(incremental!.lastSha).toBe(cold.lastSha);
    expect(incremental!.model.commitCount).toBe(cold.model.commitCount);
    expect([...incremental!.model.files.entries()].sort()).toEqual([...cold.model.files.entries()].sort());
    expect([...incremental!.model.couplings.entries()].sort()).toEqual([...cold.model.couplings.entries()].sort());
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
