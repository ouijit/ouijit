import { test, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getMainGitDir } from '../../sandbox/gitDir';

test("the git a sandbox grants is the folder's own repository, a worktree's main one, and none for a plain folder inside a repo", async () => {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-gitdir-')));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  git('init', '-q');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
  const worktree = path.join(repo, 'wt');
  git('worktree', 'add', '-q', worktree);
  const plain = path.join(repo, 'conversations', 'home-1');
  fs.mkdirSync(plain, { recursive: true });

  expect(await getMainGitDir(repo)).toBe(path.join(repo, '.git'));
  expect(await getMainGitDir(worktree)).toBe(path.join(repo, '.git'));
  expect(await getMainGitDir(plain)).toBeNull();
});
