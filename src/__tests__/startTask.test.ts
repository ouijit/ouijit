import { describe, test, expect, vi } from 'vitest';
import { createTask, getTaskByNumber } from '../taskMetadata';

// Mock child_process so execAsync resolves without real git commands
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  exec: vi.fn((_cmd: string, _opts: unknown, cb: (err: null, result: { stdout: string; stderr: string }) => void) => {
    cb(null, { stdout: 'main\n', stderr: '' });
  }),
  execFile: vi.fn((_file: string, _args: string[], _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) => {
    cb(null, '', '');
  }),
}));

// Mock fs/promises — keep real readFile/writeFile for taskMetadata, stub mkdir/access/cp for worktree
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

import { startTask } from '../worktree';

describe('startTask', () => {
  test('does not change a todo task status to in_progress', async () => {
    const project = '/test/start-keeps-todo';
    await createTask(project, 1, 'My todo task', { status: 'todo' });

    const result = await startTask(project, 1);
    expect(result.success).toBe(true);

    const task = await getTaskByNumber(project, 1);
    expect(task).not.toBeNull();
    expect(task!.status).toBe('todo');
  });

  test('sets branch and worktreePath on the task', async () => {
    const project = '/test/start-sets-fields';
    await createTask(project, 1, 'Branch task', { status: 'todo' });

    const result = await startTask(project, 1, 'custom-branch-1');
    expect(result.success).toBe(true);
    expect(result.task).toBeDefined();
    expect(result.task!.branch).toBe('custom-branch-1');
    expect(result.worktreePath).toBeTruthy();
  });

  test('rejects starting a non-todo task', async () => {
    const project = '/test/start-reject-nontodo';
    await createTask(project, 1, 'In progress task'); // defaults to in_progress

    const result = await startTask(project, 1);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Task is already started');
  });

  test('returns error for non-existent task', async () => {
    const result = await startTask('/test/start-missing', 99);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Task not found');
  });
});
