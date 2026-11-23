import { test, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getMainGitDir, sandboxGitGrants } from '../../sandbox/gitDir';
import { createTask, _resetCacheForTesting } from '../../db';

test("a sandbox is granted the project's repository, and of the worktree entries in it only its own task's", async () => {
  _resetCacheForTesting();
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-gitdir-')));
  const repo = path.join(root, 'project');
  fs.mkdirSync(repo);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  git('init', '-q');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
  const own = path.join(root, 'worktrees', 'T-1');
  const other = path.join(root, 'worktrees', 'T-2');
  git('worktree', 'add', '-q', '-b', 'task-1', own);
  git('worktree', 'add', '-q', '-b', 'task-2', other);
  await createTask(repo, 1, 'Own', { branch: 'task-1', worktreePath: own });
  await createTask(repo, 2, 'Other', { branch: 'task-2', worktreePath: other });
  const plain = path.join(root, 'conversations', 'home-1');
  fs.mkdirSync(plain, { recursive: true });

  // The agent points its worktree at the other task's entry.
  fs.writeFileSync(path.join(own, '.git'), `gitdir: ${path.join(repo, '.git', 'worktrees', 'T-2')}\n`);

  const spawn = { projectPath: repo, taskId: 1, cwd: own, worktreePath: own, apiPort: 1, settings: repo };
  const grants = await sandboxGitGrants(spawn);
  const gitDir = path.join(repo, '.git');
  expect(grants?.gitDir).toBe(gitDir);
  expect(grants?.writableDirs).toContain(path.join(gitDir, 'worktrees', 'T-1'));
  expect(grants?.writableDirs).not.toContain(path.join(gitDir, 'worktrees'));
  expect(grants?.writableDirs).not.toContain(path.join(gitDir, 'worktrees', 'T-2'));

  // A terminal in the project itself is no task's, so it gets no worktree entry.
  const projectGrants = await sandboxGitGrants({ ...spawn, taskId: undefined, cwd: repo, worktreePath: undefined });
  expect(projectGrants?.writableDirs.some((dir) => dir.startsWith(path.join(gitDir, 'worktrees')))).toBe(false);

  expect(await getMainGitDir(plain)).toBeNull();
});
