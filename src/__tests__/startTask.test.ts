import { describe, test, expect, vi } from 'vitest';
import { createTask, getTaskByNumber } from '../db';

// Mock child_process so execAsync resolves without real git commands
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  exec: vi.fn((_cmd: string, _opts: unknown, cb: (err: null, result: { stdout: string; stderr: string }) => void) => {
    cb(null, { stdout: 'main\n', stderr: '' });
  }),
  execFile: vi.fn(
    (_file: string, _args: string[], _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) => {
      cb(null, '', '');
    },
  ),
}));

// Mock fs/promises — keep real readFile/writeFile for taskMetadata, stub mkdir/access/cp for worktree
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    mkdir: vi.fn(async () => undefined),
    access: vi.fn(async () => {
      throw new Error('ENOENT');
    }),
    cp: vi.fn(async () => undefined),
  };
});

// Mock koffi (native FFI, not needed in tests)
vi.mock('koffi', () => ({
  default: { load: vi.fn() },
}));

import { startTask } from '../worktree';
import { beginTask } from '../taskLifecycle';

async function mockExecBranchNotFound() {
  const { exec } = await import('node:child_process');
  vi.mocked(exec).mockImplementation(((
    cmd: string,
    _opts: unknown,
    cb: (err: Error | null, result: { stdout: string; stderr: string }) => void,
  ) => {
    if (typeof cmd === 'string' && cmd.includes('rev-parse --verify')) {
      cb(new Error('not found'), { stdout: '', stderr: '' });
    } else {
      cb(null, { stdout: 'main\n', stderr: '' });
    }
  }) as typeof exec);
}

async function restoreExecMock() {
  const { exec } = await import('node:child_process');
  vi.mocked(exec).mockImplementation(((
    _cmd: string,
    _opts: unknown,
    cb: (err: null, result: { stdout: string; stderr: string }) => void,
  ) => {
    cb(null, { stdout: 'main\n', stderr: '' });
  }) as typeof exec);
}

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

  test('creates worktree for a non-todo task without one', async () => {
    const project = '/test/start-nontodo';
    await createTask(project, 1, 'In progress task'); // defaults to in_progress

    const result = await startTask(project, 1);
    expect(result.success).toBe(true);
    expect(result.worktreePath).toBeTruthy();
  });

  test('returns error for non-existent task', async () => {
    const result = await startTask('/test/start-missing', 99);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Task not found');
  });

  test('passes baseBranch as start point to git worktree add', async () => {
    const { exec } = await import('node:child_process');
    await mockExecBranchNotFound();

    const project = '/test/start-with-base';
    await createTask(project, 1, 'Child task', { status: 'todo' });

    await startTask(project, 1, undefined, 'feat/parent-branch');

    const execCalls = vi.mocked(exec).mock.calls;
    const wtAddCall = execCalls.find(([cmd]) => typeof cmd === 'string' && cmd.includes('git worktree add -b'));
    expect(wtAddCall).toBeDefined();
    expect(wtAddCall![0]).toContain('feat/parent-branch');

    await restoreExecMock();
  });

  test('sets mergeTarget to baseBranch when provided', async () => {
    const project = '/test/start-merge-target';
    await createTask(project, 1, 'Child task', { status: 'todo' });

    const result = await startTask(project, 1, undefined, 'feat/parent-branch');
    expect(result.success).toBe(true);

    const task = await getTaskByNumber(project, 1);
    expect(task!.mergeTarget).toBe('feat/parent-branch');
  });

  test('falls back to HEAD branch when no baseBranch provided', async () => {
    const project = '/test/start-no-base';
    await createTask(project, 1, 'Regular task', { status: 'todo' });

    const result = await startTask(project, 1);
    expect(result.success).toBe(true);

    const task = await getTaskByNumber(project, 1);
    expect(task!.mergeTarget).toBe('main');
  });

  test('beginTask passes parent branch as baseBranch', async () => {
    const { exec } = await import('node:child_process');
    await mockExecBranchNotFound();

    const project = '/test/begin-with-parent';
    await createTask(project, 1, 'Parent', { branch: 'feat/parent', status: 'in_progress' });
    await createTask(project, 2, 'Child', { status: 'todo', parentTaskNumber: 1 });

    await beginTask(project, 2);

    const execCalls = vi.mocked(exec).mock.calls;
    const wtAddCall = execCalls.find(([cmd]) => typeof cmd === 'string' && cmd.includes('git worktree add -b'));
    expect(wtAddCall).toBeDefined();
    expect(wtAddCall![0]).toContain('feat/parent');

    await restoreExecMock();
  });

  test('beginTask falls back to HEAD when parent is missing', async () => {
    const project = '/test/begin-missing-parent';
    await createTask(project, 5, 'Orphan child', { status: 'todo', parentTaskNumber: 99 });

    const result = await beginTask(project, 5);
    expect(result.success).toBe(true);
  });

  test('awaits gitignored file copy before returning', async () => {
    const project = '/test/start-awaits-copy';
    await createTask(project, 1, 'Copy test', { status: 'todo' });

    // Make lstat take measurable time so we can detect fire-and-forget vs await
    let copyFinished = false;
    const fs = await import('node:fs/promises');
    const lstatSpy = vi.spyOn(fs, 'lstat').mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      copyFinished = true;
      throw new Error('ENOENT');
    });

    const result = await startTask(project, 1);
    expect(result.success).toBe(true);
    // If copyGitIgnoredFiles were fire-and-forget, startTask would resolve
    // before the 50ms delay elapses and copyFinished would still be false
    expect(copyFinished).toBe(true);

    lstatSpy.mockRestore();
  });
});
