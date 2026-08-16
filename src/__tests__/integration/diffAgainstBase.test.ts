/**
 * What a comparison contains, against a real git repo.
 *
 * The panel asks one question of every base — what does this worktree have that
 * the base does not — so the answer has to reach the working tree, and has to
 * start where the branch left the base rather than at the base's tip. Neither
 * is visible from the file list itself: a diff that quietly stops at HEAD, or
 * one that reports someone else's commits inverted, both render as an ordinary
 * list of files.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';
import { getGitFileStatus, getWorktreeFileDiff } from '../../git';
import { UNCOMMITTED_BASE, filesInDiff } from '../../diffSource';

let tmpDir: string;
let repoDir: string;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repoDir, encoding: 'utf8' }).trim();
}

async function write(file: string, contents: string): Promise<void> {
  await fs.writeFile(path.join(repoDir, file), contents);
}

/** The paths a comparison against `base` reports, in the order the panel shows them. */
async function pathsAgainst(base?: string): Promise<string[]> {
  const status = await getGitFileStatus(repoDir, base);
  return status ? filesInDiff(status).map((f) => f.path) : [];
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ouijit-diff-base-'));
  repoDir = path.join(tmpDir, 'project');
  await fs.mkdir(repoDir, { recursive: true });

  git('init', '--initial-branch=main');
  git('config', 'user.email', 'test@test.com');
  git('config', 'user.name', 'Test');

  await write('kept.txt', 'one\n');
  await write('.gitignore', 'ignored.txt\n');
  git('add', '.');
  git('commit', '-m', 'first');

  git('checkout', '-b', 'feat/x');
  await write('committed.txt', 'from the branch\n');
  git('add', 'committed.txt');
  git('commit', '-m', 'branch work');

  await write('kept.txt', 'one\ntwo\n'); // uncommitted edit to a tracked file
  await write('untracked.txt', 'new\n');
  await write('ignored.txt', 'noise\n');
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('what a comparison contains', () => {
  test('against the base: committed, uncommitted and untracked alike', async () => {
    expect(await pathsAgainst('main')).toEqual(['committed.txt', 'kept.txt', 'untracked.txt']);
  });

  test('against the last commit: only what has not been committed', async () => {
    expect(await pathsAgainst(UNCOMMITTED_BASE)).toEqual(['kept.txt', 'untracked.txt']);
  });

  test('an ignored file is in neither', async () => {
    expect(await pathsAgainst('main')).not.toContain('ignored.txt');
    expect(await pathsAgainst(UNCOMMITTED_BASE)).not.toContain('ignored.txt');
  });

  test('the base moving on does not put its commits in your diff', async () => {
    git('checkout', 'main');
    await write('theirs.txt', 'someone else\n');
    git('add', 'theirs.txt');
    git('commit', '-m', 'landed on main after you branched');
    git('checkout', 'feat/x');

    const paths = await pathsAgainst('main');
    expect(paths).not.toContain('theirs.txt');
    expect(paths).toContain('committed.txt');
  });

  test('the ref it answered for is reported back', async () => {
    expect((await getGitFileStatus(repoDir, 'main'))?.base).toBe('main');
    // Nothing asked for: the project's main branch.
    expect((await getGitFileStatus(repoDir))?.base).toBe('main');
  });
});

describe('one file of a comparison', () => {
  test('carries the uncommitted edit, not just what was committed', async () => {
    const diff = await getWorktreeFileDiff(repoDir, 'main', 'kept.txt');
    expect(diff?.hunks.flatMap((h) => h.lines).some((l) => l.content.includes('two'))).toBe(true);
  });

  test('reads the same comparison the file list was built from', async () => {
    // Committed on the branch, so it is in the base comparison and not in the
    // one against the last commit.
    expect((await getWorktreeFileDiff(repoDir, 'main', 'committed.txt'))?.hunks.length).toBeGreaterThan(0);
    expect((await getWorktreeFileDiff(repoDir, UNCOMMITTED_BASE, 'committed.txt'))?.hunks.length ?? 0).toBe(0);
  });

  test('a rename needs both paths, or it reads as a whole new file', async () => {
    git('checkout', '--', 'kept.txt');
    git('mv', 'kept.txt', 'moved.txt');

    // A pure rename has no line changes, and git only pairs the two sides when
    // it is given both paths.
    expect((await getWorktreeFileDiff(repoDir, 'main', 'moved.txt', 'kept.txt'))?.hunks.length ?? 0).toBe(0);

    const unpaired = await getWorktreeFileDiff(repoDir, 'main', 'moved.txt');
    expect(unpaired?.hunks.flatMap((h) => h.lines).filter((l) => l.type === 'addition').length).toBe(1);
  });
});
