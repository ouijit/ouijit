import { test, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getMainGitDir, sandboxGitGrants } from '../../sandbox/gitDir';
import { createTask, _resetCacheForTesting } from '../../db';

test("a task's sandbox may read the project's repository and write only its objects, its own worktree entry and its own branch", async () => {
  _resetCacheForTesting();
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-gitdir-')));
  const repo = path.join(root, 'project');
  fs.mkdirSync(repo);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  git('init', '-q');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
  const own = path.join(root, 'worktrees', 'T-1');
  const other = path.join(root, 'worktrees', 'T-2');
  git('worktree', 'add', '-q', '-b', 'feat/one', own);
  git('worktree', 'add', '-q', '-b', 'task-2', other);
  await createTask(repo, 1, 'Own', { branch: 'feat/one', worktreePath: own });
  await createTask(repo, 2, 'Other', { branch: 'task-2', worktreePath: other });
  const plain = path.join(root, 'conversations', 'home-1');
  fs.mkdirSync(plain, { recursive: true });

  // The agent points its worktree at the other task's entry.
  fs.writeFileSync(path.join(own, '.git'), `gitdir: ${path.join(repo, '.git', 'worktrees', 'T-2')}\n`);

  const spawn = { projectPath: repo, taskId: 1, cwd: own, worktreePath: own, apiPort: 1, settings: repo };
  const grants = await sandboxGitGrants(spawn);
  const gitDir = path.join(repo, '.git');
  expect(grants).toEqual({
    gitDir,
    writableDirs: [path.join(gitDir, 'objects'), path.join(gitDir, 'worktrees', 'T-1')],
    writableFiles: [
      path.join(gitDir, 'refs', 'heads', 'feat', 'one'),
      path.join(gitDir, 'refs', 'heads', 'feat', 'one.lock'),
      path.join(gitDir, 'logs', 'refs', 'heads', 'feat', 'one'),
      path.join(gitDir, 'packed-refs.lock'),
    ],
  });

  // A terminal in the project itself is no task's, so it writes no worktree entry and no branch.
  expect(await sandboxGitGrants({ ...spawn, taskId: undefined, cwd: repo, worktreePath: undefined })).toEqual({
    gitDir,
    writableDirs: [path.join(gitDir, 'objects')],
    writableFiles: [],
  });

  expect(await getMainGitDir(plain)).toBeNull();
});
