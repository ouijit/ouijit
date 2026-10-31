/**
 * A project's default base: where a new task's branch starts, what it merges
 * back into, and what happens when the base is a remote branch.
 *
 * Real database, real git repos: an origin, the project cloned from it, and a
 * second clone that pushes behind the project's back.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { _resetCacheForTesting, setGlobalSetting } from '../../db';
import { createTaskWorktree, createTodoTask, defaultDiffBase, startTask } from '../../worktree';

let tmpDir: string;
let projectDir: string;
let otherDir: string;

const git = (cwd: string, command: string) => execSync(`git ${command}`, { cwd, encoding: 'utf8' }).trim();

function commit(cwd: string, message: string) {
  git(cwd, `commit --allow-empty -m "${message}"`);
  return git(cwd, 'rev-parse HEAD');
}

beforeEach(async () => {
  _resetCacheForTesting();
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ouijit-default-base-'));
  const originDir = path.join(tmpDir, 'origin.git');
  projectDir = path.join(tmpDir, 'project');
  otherDir = path.join(tmpDir, 'other');

  execSync(`git init --bare -b main ${originDir}`);
  for (const dir of [projectDir, otherDir]) {
    execSync(`git clone -q ${originDir} ${dir}`);
    git(dir, 'config user.email "test@test.com"');
    git(dir, 'config user.name "Test"');
  }
  git(projectDir, 'checkout -q -b main');
  commit(projectDir, 'Initial commit');
  git(projectDir, 'push -q -u origin main');
  git(otherDir, 'pull -q origin main');

  // The project sits on a feature branch, which is where a task would branch from without a default base.
  git(projectDir, 'checkout -q -b feature');
  commit(projectDir, 'Feature work');
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const setBase = (base: string) =>
  setGlobalSetting(`worktree:${projectDir}`, JSON.stringify({ mode: 'clean-checkout', base }));

describe('a default base', () => {
  test('a remote base is fetched first, branched from without tracking it, and merges into its local branch', async () => {
    const pushed = commit(otherDir, 'Pushed elsewhere');
    git(otherDir, 'push -q origin main');
    await setBase('origin/main');

    const todo = await createTodoTask(projectDir, 'From the remote');
    const started = await startTask(projectDir, todo.task!.taskNumber);
    expect(started.success).toBe(true);
    const worktree = started.worktreePath!;
    expect(git(worktree, 'rev-parse HEAD')).toBe(pushed);
    expect(() => git(worktree, 'rev-parse --abbrev-ref @{upstream}')).toThrow();
    expect(started.task?.mergeTarget).toBe('main');

    const created = await createTaskWorktree(projectDir, 'Made with its worktree');
    expect(created.success).toBe(true);
    expect(git(created.task!.worktreePath!, 'rev-parse HEAD')).toBe(pushed);
    expect(created.task?.mergeTarget).toBe('main');
    // Their diffs, and the project root's, read against the default base; work
    // merging elsewhere reads against where it merges.
    expect(await defaultDiffBase(projectDir, 'main')).toBe('origin/main');
    expect(await defaultDiffBase(projectDir, undefined)).toBe('origin/main');
    expect(await defaultDiffBase(projectDir, 'feature')).toBe('feature');
  });

  test('without one a task branches from what is checked out, and a base git lacks is refused by name', async () => {
    const feature = git(projectDir, 'rev-parse HEAD');
    const plain = await createTodoTask(projectDir, 'Plain');
    const started = await startTask(projectDir, plain.task!.taskNumber);
    expect(git(started.worktreePath!, 'rev-parse HEAD')).toBe(feature);
    expect(started.task?.mergeTarget).toBe('feature');
    expect(await defaultDiffBase(projectDir, 'feature')).toBe('feature');
    expect(await defaultDiffBase(projectDir, undefined)).toBeUndefined();

    await setBase('origin/nope');
    const missing = await createTodoTask(projectDir, 'Missing base');
    const refused = await startTask(projectDir, missing.task!.taskNumber);
    expect(refused.success).toBe(false);
    expect(refused.error).toContain('origin/nope');
    expect(await defaultDiffBase(projectDir, 'main')).toBe('main');
  });
});
