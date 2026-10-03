/**
 * Integration test for the one-time Lima leftover cleanup. Uses a real
 * temporary git repo and a real HOME, so the worktree registrations and branch
 * deletions are the ones git actually performs.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { removeLimaLeftovers } from '../../services/limaLeftovers';
import { addProject, _resetCacheForTesting } from '../../db';
import { getUserDataPath } from '../../paths';

let tmpDir: string;
let repoDir: string;
let prevHome: string | undefined;

/** Branches in the repo, so an assertion can say exactly what survived. */
function branches(): string[] {
  return execSync("git branch --format='%(refname:short)'", { cwd: repoDir, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .sort();
}

function registeredWorktrees(): string[] {
  return execSync('git worktree list --porcelain', { cwd: repoDir, encoding: 'utf8' })
    .split('\n')
    .filter((l) => l.startsWith('worktree '))
    .map((l) => l.slice('worktree '.length));
}

beforeEach(async () => {
  _resetCacheForTesting();

  // Resolved, because git records a worktree's realpath and macOS's
  // /var/folders tmpdir is a symlink to /private/var/folders.
  tmpDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ouijit-lima-leftovers-')));
  prevHome = process.env.HOME;
  process.env.HOME = tmpDir;

  repoDir = path.join(tmpDir, 'my-app');
  await fs.mkdir(repoDir, { recursive: true });
  execSync('git init', { cwd: repoDir });
  execSync('git config user.email "test@test.com"', { cwd: repoDir });
  execSync('git config user.name "Test"', { cwd: repoDir });
  execSync('git commit --allow-empty -m "Initial commit"', { cwd: repoDir });
  await addProject(repoDir);
});

afterEach(async () => {
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  await fs.rm(tmpDir, { recursive: true, force: true });
  await fs.rm(path.join(getUserDataPath(), 'sandbox-configs'), { recursive: true, force: true });
});

describe('removeLimaLeftovers', () => {
  test('removes the sandbox views and configs, leaves the VM images, never runs again', async () => {
    // A task's sandbox view, as src/lima/sandboxSync.ts left it: a worktree
    // under ~/Ouijit/sandbox-views/<project basename>/ on branch s/<branch>.
    const viewPath = path.join(tmpDir, 'Ouijit', 'sandbox-views', 'my-app', 'T-1-sandbox');
    execSync('git branch feat-1', { cwd: repoDir });
    execSync(`git worktree add -b s/feat-1 "${viewPath}" feat-1`, { cwd: repoDir });

    // A branch the user happens to have named under the same prefix, with no
    // sandbox worktree on it. Cleanup must leave it alone.
    execSync('git branch s/my-own-spike', { cwd: repoDir });

    const diskImage = path.join(tmpDir, '.ouijit', 'lima', 'ouijit-8f4447f2867c', 'diffdisk');
    await fs.mkdir(path.dirname(diskImage), { recursive: true });
    await fs.writeFile(diskImage, 'pretend Ubuntu image');

    const configsDir = path.join(getUserDataPath(), 'sandbox-configs');
    await fs.mkdir(configsDir, { recursive: true });
    await fs.writeFile(path.join(configsDir, 'ouijit-8f4447f2867c.yaml'), 'cpus: 4\n');

    expect(registeredWorktrees()).toContain(viewPath);

    await removeLimaLeftovers();

    // The view is gone from disk and from git's registrations, so it no longer
    // shows up in `git worktree list`.
    expect(registeredWorktrees()).toEqual([repoDir]);
    await expect(fs.access(path.join(tmpDir, 'Ouijit', 'sandbox-views'))).rejects.toThrow();

    // Only the branch a removed view was checked out on; the user's own
    // s/-prefixed branch and the parent branch both survive.
    expect(branches()).toEqual(['feat-1', 'main', 's/my-own-spike'].sort());

    // The orphaned YAML configs go; the disk image stays, for the user to
    // delete when they choose.
    await expect(fs.access(configsDir)).rejects.toThrow();
    await expect(fs.readFile(diskImage, 'utf8')).resolves.toBe('pretend Ubuntu image');

    // Once-only: a second launch must not re-walk every project's git. Put a
    // sandbox view back and show the next run leaves it untouched.
    const reappeared = path.join(tmpDir, 'Ouijit', 'sandbox-views', 'my-app');
    await fs.mkdir(reappeared, { recursive: true });
    await removeLimaLeftovers();
    await expect(fs.access(reappeared)).resolves.toBeUndefined();
  });

  test('a project whose directory has gone does not stop the rest of the cleanup', async () => {
    const gone = path.join(tmpDir, 'deleted-project');
    await fs.mkdir(gone, { recursive: true });
    execSync('git init', { cwd: gone });
    await addProject(gone);
    await fs.rm(gone, { recursive: true, force: true });

    const configsDir = path.join(getUserDataPath(), 'sandbox-configs');
    await fs.mkdir(configsDir, { recursive: true });

    await expect(removeLimaLeftovers()).resolves.toBeUndefined();
    await expect(fs.access(configsDir)).rejects.toThrow();
  });
});
