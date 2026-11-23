/**
 * A task merges into a branch its sandbox cannot write. If that branch, or the
 * remote-tracking ref of it, moves by some other means while the task runs,
 * the squash merge would land on commits nobody reviewed, and new tasks would
 * start from them.
 */

import { test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { _resetCacheForTesting, setGlobalSetting } from '../../db';
import { createTodoTask, shipWorktree, startTask } from '../../worktree';

let tmpDir: string;
let projectDir: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

beforeEach(() => {
  _resetCacheForTesting();
  tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-protected-refs-')));
  const originDir = path.join(tmpDir, 'origin.git');
  projectDir = path.join(tmpDir, 'project');
  git(tmpDir, 'init', '-q', '--bare', '-b', 'main', originDir);
  git(tmpDir, 'clone', '-q', originDir, projectDir);
  git(projectDir, 'config', 'user.email', 'test@test.com');
  git(projectDir, 'config', 'user.name', 'Test');
  git(projectDir, 'checkout', '-q', '-b', 'main');
  git(projectDir, 'commit', '-q', '--allow-empty', '-m', 'first');
  git(projectDir, 'push', '-q', '-u', 'origin', 'main');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('a merge goes ahead after git on the host moves its target, and refuses after a ref is rewritten behind its back', async () => {
  await setGlobalSetting(`worktree:${projectDir}`, JSON.stringify({ mode: 'clean-checkout' }));
  const todo = await createTodoTask(projectDir, 'Feature');
  const started = await startTask(projectDir, todo.task!.taskNumber);
  const worktree = started.worktreePath!;
  const branch = started.task!.branch!;
  fs.writeFileSync(path.join(worktree, 'feature.txt'), 'reviewed\n');
  git(worktree, 'add', '.');
  git(worktree, 'commit', '-q', '-m', 'reviewed');

  fs.writeFileSync(path.join(projectDir, 'host.txt'), 'by the user\n');
  git(projectDir, 'add', '.');
  git(projectDir, 'commit', '-q', '-m', 'on main, from the host');
  git(projectDir, 'push', '-q', 'origin', 'main');

  const reviewedBase = git(projectDir, 'rev-parse', 'main');
  const planted = git(projectDir, 'commit-tree', '-p', reviewedBase, '-m', 'unreviewed', `${reviewedBase}^{tree}`);
  fs.writeFileSync(path.join(projectDir, '.git', 'refs', 'heads', 'main'), `${planted}\n`);

  const refused = await shipWorktree(projectDir, branch);
  expect(refused.success).toBe(false);
  expect(refused.error).toMatch(/^main moved since this task started/);
  expect(git(projectDir, 'rev-parse', 'main')).toBe(planted);

  git(projectDir, 'update-ref', 'refs/heads/main', reviewedBase);
  expect(await shipWorktree(projectDir, branch)).toMatchObject({ success: true });
  expect(git(projectDir, 'show', 'main:feature.txt')).toBe('reviewed');
  expect(git(projectDir, 'show', 'main:host.txt')).toBe('by the user');
  expect(git(projectDir, 'log', '--format=%s', 'main')).not.toContain('unreviewed');
});
