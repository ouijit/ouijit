/**
 * The refs a diff can be compared against, and keeping a remote one current,
 * against a real git repo.
 *
 * A remote-tracking ref is a local file that only moves when something fetches,
 * so a comparison against `origin/main` is a comparison against whatever was
 * last pulled down — and there is no way to tell from the diff itself.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';
import { listDiffBases, fetchDiffBase } from '../../git';

let tmpDir: string;
let remoteDir: string;
let repoDir: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ouijit-diff-bases-'));
  remoteDir = path.join(tmpDir, 'remote.git');
  repoDir = path.join(tmpDir, 'project');

  execFileSync('git', ['init', '--bare', '--initial-branch=main', remoteDir]);

  const seed = path.join(tmpDir, 'seed');
  await fs.mkdir(seed, { recursive: true });
  git(seed, 'init', '--initial-branch=main');
  git(seed, 'config', 'user.email', 'test@test.com');
  git(seed, 'config', 'user.name', 'Test');
  await fs.writeFile(path.join(seed, 'a.txt'), 'one\n');
  git(seed, 'add', '.');
  git(seed, 'commit', '-m', 'first');
  git(seed, 'remote', 'add', 'origin', remoteDir);
  git(seed, 'push', 'origin', 'main');

  execFileSync('git', ['clone', remoteDir, repoDir]);
  git(repoDir, 'config', 'user.email', 'test@test.com');
  git(repoDir, 'config', 'user.name', 'Test');
  git(repoDir, 'checkout', '-b', 'feat/x');
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('the refs a diff can be taken against', () => {
  test('lists local branches and remote-tracking ones, each marked as what it is', async () => {
    const bases = await listDiffBases(repoDir);
    expect(bases.refs).toContainEqual({ ref: 'main', branch: 'main', remote: null });
    expect(bases.refs).toContainEqual({ ref: 'feat/x', branch: 'feat/x', remote: null });
    expect(bases.refs).toContainEqual({ ref: 'origin/main', branch: 'main', remote: 'origin' });
  });

  test('a branch sits beside the remotes carrying it', async () => {
    const refs = (await listDiffBases(repoDir)).refs.map((r) => r.ref);
    expect(refs.indexOf('origin/main')).toBe(refs.indexOf('main') + 1);
  });

  test('leaves out origin/HEAD, which stands for a branch already listed', async () => {
    expect((await listDiffBases(repoDir)).refs.map((r) => r.ref)).not.toContain('origin/HEAD');
  });

  test('reads what the checked-out branch tracks, and the remote to reach for', async () => {
    // Nothing tracks anything yet: the branch was made locally and never pushed.
    expect((await listDiffBases(repoDir)).upstream).toBeNull();
    expect((await listDiffBases(repoDir)).defaultRemote).toBe('origin');

    git(repoDir, 'push', '--set-upstream', 'origin', 'feat/x');
    expect((await listDiffBases(repoDir)).upstream).toBe('origin/feat/x');
  });

  test('reports when the repo last fetched', async () => {
    // A fresh clone has never fetched, so there is nothing to report yet.
    expect((await listDiffBases(repoDir)).lastFetch).toBeNull();

    await fetchDiffBase(repoDir, 'origin/main');
    const after = (await listDiffBases(repoDir)).lastFetch;
    expect(after).not.toBeNull();
    expect(after).toBeGreaterThan(Date.now() - 60_000);
  });

  test('says nothing about a ref with no remote in it', async () => {
    const result = await fetchDiffBase(repoDir, 'main');
    expect(result.success).toBe(false);
  });
});

describe('keeping a remote base current', () => {
  test('moves the tracking ref to what the remote has now', async () => {
    const before = git(repoDir, 'rev-parse', 'origin/main');

    const other = path.join(tmpDir, 'other');
    execFileSync('git', ['clone', remoteDir, other]);
    git(other, 'config', 'user.email', 'test@test.com');
    git(other, 'config', 'user.name', 'Test');
    await fs.writeFile(path.join(other, 'a.txt'), 'two\n');
    git(other, 'commit', '-am', 'second');
    git(other, 'push', 'origin', 'main');

    // Until the fetch, a diff against origin/main is a diff against what this
    // clone happened to have when it was made.
    expect(git(repoDir, 'rev-parse', 'origin/main')).toBe(before);

    const result = await fetchDiffBase(repoDir, 'origin/main');
    expect(result.success).toBe(true);
    expect(git(repoDir, 'rev-parse', 'origin/main')).not.toBe(before);
  });
});
