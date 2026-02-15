import { describe, test, expect, vi } from 'vitest';
import { createTask, getTaskByNumber } from '../taskMetadata';

// Mock child_process so git commands don't actually run
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  exec: vi.fn((_cmd: string, _opts: unknown, cb: (err: null, result: { stdout: string; stderr: string }) => void) => {
    cb(null, { stdout: '', stderr: '' });
  }),
}));

// Mock fs/promises — keep real readFile/writeFile for taskMetadata, stub the rest
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    mkdir: vi.fn(async () => undefined),
    access: vi.fn(async () => { throw new Error('ENOENT'); }),
    cp: vi.fn(async () => undefined),
  };
});

// Mock koffi (native FFI, not needed in tests)
vi.mock('koffi', () => ({
  default: { load: vi.fn() },
}));

import { removeTaskWorktree } from '../worktree';

describe('removeTaskWorktree', () => {
  test('deletes the task matching the provided taskNumber, not the directory name', async () => {
    const project = '/test/remove-worktree-mismatch';

    // Task 2 exists but its worktree directory is T-5 (due to collision avoidance)
    await createTask(project, 2, 'Task two', { branch: 'feat/two', worktreePath: '/worktrees/T-5' });
    // Task 5 also exists
    await createTask(project, 5, 'Task five', { branch: 'feat/five', worktreePath: '/worktrees/T-10' });

    // Delete task 2 via its mismatched worktree path T-5
    const result = await removeTaskWorktree(project, '/worktrees/T-5', 2);
    expect(result.success).toBe(true);

    // Task 2 should be deleted
    const task2 = await getTaskByNumber(project, 2);
    expect(task2).toBeNull();

    // Task 5 should NOT be deleted (it would have been with the old directory-parsing logic)
    const task5 = await getTaskByNumber(project, 5);
    expect(task5).not.toBeNull();
    expect(task5!.name).toBe('Task five');
  });

  test('deletes the correct task when directory name matches', async () => {
    const project = '/test/remove-worktree-match';

    await createTask(project, 3, 'Task three', { branch: 'feat/three', worktreePath: '/worktrees/T-3' });

    const result = await removeTaskWorktree(project, '/worktrees/T-3', 3);
    expect(result.success).toBe(true);

    const task = await getTaskByNumber(project, 3);
    expect(task).toBeNull();
  });
});
