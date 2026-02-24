/**
 * Integration tests for checkTaskWorktree and recoverTaskWorktree.
 * Uses a real temporary git repo — no mocked child_process, fs, or koffi.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { checkTaskWorktree, recoverTaskWorktree } from '../../worktree';
import { createTask, getTaskByNumber, _resetCacheForTesting } from '../../db';

let tmpDir: string;
let repoDir: string;

beforeEach(async () => {
  _resetCacheForTesting();

  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ouijit-recover-'));
  repoDir = path.join(tmpDir, 'project');
  await fs.mkdir(repoDir, { recursive: true });

  execSync('git init', { cwd: repoDir });
  execSync('git commit --allow-empty -m "Initial commit"', { cwd: repoDir });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('checkTaskWorktree', () => {
  test('returns exists: true when worktree directory is present', async () => {
    const wtPath = path.join(tmpDir, 'wt-1');
    execSync(`git worktree add -b feat-1 "${wtPath}"`, { cwd: repoDir });

    await createTask(repoDir, 1, 'Has worktree', {
      branch: 'feat-1',
      worktreePath: wtPath,
    });

    const result = await checkTaskWorktree(repoDir, 1);
    expect(result.exists).toBe(true);
    expect(result.branchExists).toBe(true);
  });

  test('detects missing directory but surviving branch', async () => {
    const wtPath = path.join(tmpDir, 'wt-2');
    execSync(`git worktree add -b feat-2 "${wtPath}"`, { cwd: repoDir });
    await fs.rm(wtPath, { recursive: true, force: true });

    await createTask(repoDir, 1, 'Dir gone', {
      branch: 'feat-2',
      worktreePath: wtPath,
    });

    const result = await checkTaskWorktree(repoDir, 1);
    expect(result.exists).toBe(false);
    expect(result.branchExists).toBe(true);
  });

  test('detects both directory and branch missing', async () => {
    const wtPath = path.join(tmpDir, 'wt-3');
    execSync(`git worktree add -b feat-3 "${wtPath}"`, { cwd: repoDir });
    await fs.rm(wtPath, { recursive: true, force: true });
    execSync('git worktree prune', { cwd: repoDir });
    execSync('git branch -D feat-3', { cwd: repoDir });

    await createTask(repoDir, 1, 'Both gone', {
      branch: 'feat-3',
      worktreePath: wtPath,
    });

    const result = await checkTaskWorktree(repoDir, 1);
    expect(result.exists).toBe(false);
    expect(result.branchExists).toBe(false);
  });

  test('returns both false for non-existent task', async () => {
    const result = await checkTaskWorktree(repoDir, 99);
    expect(result).toEqual({ exists: false, branchExists: false });
  });
});

describe('recoverTaskWorktree', () => {
  test('recreates worktree and preserves committed work', async () => {
    const wtPath = path.join(tmpDir, 'wt-recover');
    execSync(`git worktree add -b feat-recover "${wtPath}"`, { cwd: repoDir });
    await fs.writeFile(path.join(wtPath, 'work.txt'), 'important work');
    execSync('git add work.txt && git commit -m "Add work"', { cwd: wtPath });
    await fs.rm(wtPath, { recursive: true, force: true });

    await createTask(repoDir, 1, 'Recoverable', {
      branch: 'feat-recover',
      worktreePath: wtPath,
    });

    const result = await recoverTaskWorktree(repoDir, 1);
    expect(result.success).toBe(true);
    expect(result.worktreePath).toBeTruthy();

    // The recovered worktree should contain the committed file
    const content = await fs.readFile(path.join(result.worktreePath!, 'work.txt'), 'utf-8');
    expect(content).toBe('important work');

    // Task metadata should point to the new path
    const task = await getTaskByNumber(repoDir, 1);
    expect(task!.worktreePath).toBe(result.worktreePath);
  });

  test('reuses existing worktree when branch is already checked out', async () => {
    // Create a worktree at path A, then record a stale path B in the task
    const realWtPath = path.join(tmpDir, 'wt-real');
    const staleWtPath = path.join(tmpDir, 'wt-stale');
    execSync(`git worktree add -b feat-reuse "${realWtPath}"`, { cwd: repoDir });

    await createTask(repoDir, 1, 'Stale path', {
      branch: 'feat-reuse',
      worktreePath: staleWtPath, // points to a path that doesn't exist
    });

    const result = await recoverTaskWorktree(repoDir, 1);
    expect(result.success).toBe(true);
    // Should reuse the existing worktree, not create a new one
    // (git resolves symlinks, e.g. /var → /private/var on macOS)
    const realResolved = await fs.realpath(realWtPath);
    expect(result.worktreePath).toBe(realResolved);

    // Task metadata should be updated to the real path
    const task = await getTaskByNumber(repoDir, 1);
    expect(task!.worktreePath).toBe(realResolved);
  });

  test('fails when branch has been deleted', async () => {
    const wtPath = path.join(tmpDir, 'wt-no-branch');
    execSync(`git worktree add -b feat-gone "${wtPath}"`, { cwd: repoDir });
    await fs.rm(wtPath, { recursive: true, force: true });
    execSync('git worktree prune', { cwd: repoDir });
    execSync('git branch -D feat-gone', { cwd: repoDir });

    await createTask(repoDir, 1, 'Branch gone', {
      branch: 'feat-gone',
      worktreePath: wtPath,
    });

    const result = await recoverTaskWorktree(repoDir, 1);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Branch not found');
  });

  test('fails when task has no branch', async () => {
    await createTask(repoDir, 1, 'No branch', { status: 'todo' });

    const result = await recoverTaskWorktree(repoDir, 1);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Task has no branch');
  });

  test('fails for non-existent task', async () => {
    const result = await recoverTaskWorktree(repoDir, 99);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Task not found');
  });
});
