import { describe, test, expect, vi, beforeEach } from 'vitest';
import { createTask, getTaskByNumber } from '../db';

// Mock child_process so git commands don't actually run.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execSync: vi.fn(),
    exec: vi.fn((_cmd: string, _opts: unknown, cb: (err: null, result: { stdout: string; stderr: string }) => void) => {
      cb(null, { stdout: 'main\n', stderr: '' });
    }),
    execFile: vi.fn(
      (
        _file: string,
        args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void,
      ) => {
        if (Array.isArray(args) && args.includes('--verify')) {
          cb(new Error('not found'), '', '');
        } else {
          cb(null, '', '');
        }
      },
    ),
  };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    mkdir: vi.fn(async () => undefined),
    access: vi.fn(async () => {
      throw new Error('ENOENT');
    }),
    cp: vi.fn(async () => undefined),
    rm: vi.fn(async () => undefined),
  };
});

vi.mock('koffi', () => ({
  default: { load: vi.fn() },
}));

// Mock sandboxSync so removeTaskWorktree's stopSandboxView call doesn't shell
// out to real git commands during unit tests.
const { stopSandboxViewMock } = vi.hoisted(() => ({ stopSandboxViewMock: vi.fn(async () => undefined) }));
vi.mock('../lima/sandboxSync', () => ({
  stopSandboxView: stopSandboxViewMock,
  // Exported for re-use by other modules; stubs are fine here.
  startSandboxView: vi.fn(async () => ({ path: '/sandbox/T', branch: 'T-1-sandbox' })),
  watchSandboxRef: vi.fn(() => () => {}),
  ffMergeSandboxToUser: vi.fn(async () => ({ ok: true, ffMerged: false })),
  getSandboxBranchName: (n: number) => `T-${n}-sandbox`,
  getSandboxViewBaseDir: (name: string) => `/fake-home/Ouijit/sandbox-views/${name}`,
  getSandboxViewPath: (name: string, n: number) => `/fake-home/Ouijit/sandbox-views/${name}/T-${n}`,
}));

import { createTaskWorktree, startTask, recoverTaskWorktree, removeTaskWorktree } from '../worktree';
import { beginTask, createBranchFromTask } from '../taskLifecycle';
import { exec as execMockedRaw } from 'node:child_process';

const execMocked = vi.mocked(execMockedRaw);

function findLsFilesCall(): unknown[] | undefined {
  return execMocked.mock.calls.find(
    (call) => typeof call[0] === 'string' && (call[0] as string).includes('git ls-files'),
  ) as unknown[] | undefined;
}

beforeEach(() => {
  stopSandboxViewMock.mockClear();
  execMocked.mockClear();
});

describe('createTaskWorktree sandboxed behavior', () => {
  test('persists sandboxed=true on the task row', async () => {
    const project = '/test/sandboxed-create-persists';
    const result = await createTaskWorktree(project, 'Sandboxed task', undefined, undefined, true);
    expect(result.success).toBe(true);
    const task = await getTaskByNumber(project, result.task!.taskNumber);
    expect(task!.sandboxed).toBe(true);
  });

  test('skips git ls-files (and copyGitIgnoredFiles) when sandboxed', async () => {
    const project = '/test/sandboxed-create-skip';
    const result = await createTaskWorktree(project, 'Sandboxed', undefined, undefined, true);
    expect(result.success).toBe(true);
    expect(findLsFilesCall()).toBeUndefined();
  });

  test('still calls git ls-files when not sandboxed (regression guard)', async () => {
    const project = '/test/sandboxed-create-regression';
    const result = await createTaskWorktree(project, 'Normal', undefined, undefined, false);
    expect(result.success).toBe(true);
    expect(findLsFilesCall()).toBeDefined();
  });
});

describe('beginTask sandbox propagation', () => {
  test('forwards task.sandboxed into startTask (skips copy)', async () => {
    const project = '/test/sandboxed-begin';
    await createTask(project, 1, 'Sandboxed todo', { status: 'todo', sandboxed: true });

    const result = await beginTask(project, 1);
    expect(result.success).toBe(true);
    expect(findLsFilesCall()).toBeUndefined();
  });

  test('non-sandboxed begin still copies', async () => {
    const project = '/test/nonsandboxed-begin';
    await createTask(project, 1, 'Regular todo', { status: 'todo' });

    const result = await beginTask(project, 1);
    expect(result.success).toBe(true);
    expect(findLsFilesCall()).toBeDefined();
  });
});

describe('recoverTaskWorktree sandbox behavior', () => {
  test('skips copyGitIgnoredFiles when task is sandboxed', async () => {
    const project = '/test/sandboxed-recover';
    await createTask(project, 7, 'Sandbox recovered', {
      branch: 'feat/sandbox-recover',
      status: 'in_progress',
      sandboxed: true,
      worktreePath: '/old/path',
    });

    const result = await recoverTaskWorktree(project, 7);
    expect(result.success).toBe(true);
    expect(findLsFilesCall()).toBeUndefined();
  });
});

describe('createBranchFromTask sandbox inheritance', () => {
  test('child inherits sandboxed flag from sandboxed parent', async () => {
    const project = '/test/sandbox-inherit';
    await createTask(project, 1, 'Sandbox parent', {
      branch: 'feat/parent',
      status: 'in_progress',
      sandboxed: true,
    });

    const result = await createBranchFromTask(project, 1, 'Child');
    expect(result.success).toBe(true);
    expect(result.task!.sandboxed).toBe(true);
  });

  test('child of non-sandboxed parent is not sandboxed', async () => {
    const project = '/test/sandbox-inherit-none';
    await createTask(project, 1, 'Regular parent', { branch: 'feat/parent', status: 'in_progress' });

    const result = await createBranchFromTask(project, 1, 'Child');
    expect(result.success).toBe(true);
    expect(result.task!.sandboxed).toBeUndefined();
  });
});

describe('removeTaskWorktree sandbox-view cleanup', () => {
  test('calls stopSandboxView when the task is sandboxed', async () => {
    const project = '/test/sandbox-remove';
    await createTask(project, 4, 'Sandbox delete', {
      branch: 'feat/del',
      worktreePath: '/worktrees/T-4',
      sandboxed: true,
    });

    const result = await removeTaskWorktree(project, '/worktrees/T-4', 4);
    expect(result.success).toBe(true);
    expect(stopSandboxViewMock).toHaveBeenCalledTimes(1);
    expect(stopSandboxViewMock).toHaveBeenCalledWith(project, 4, 'feat/del');
  });

  test('does not call stopSandboxView when task is not sandboxed', async () => {
    const project = '/test/regular-remove';
    await createTask(project, 4, 'Regular delete', {
      branch: 'feat/reg',
      worktreePath: '/worktrees/T-4',
    });

    const result = await removeTaskWorktree(project, '/worktrees/T-4', 4);
    expect(result.success).toBe(true);
    expect(stopSandboxViewMock).not.toHaveBeenCalled();
  });

  test('swallows stopSandboxView errors so task delete still succeeds', async () => {
    stopSandboxViewMock.mockRejectedValueOnce(new Error('git worktree not found'));
    const project = '/test/sandbox-remove-error';
    await createTask(project, 9, 'Sandbox delete err', {
      branch: 'feat/err',
      worktreePath: '/worktrees/T-9',
      sandboxed: true,
    });

    const result = await removeTaskWorktree(project, '/worktrees/T-9', 9);
    expect(result.success).toBe(true);
  });
});

describe('startTask sandbox flag', () => {
  test('sandboxed=true skips ls-files', async () => {
    const project = '/test/start-sandbox';
    await createTask(project, 1, 'Sandbox todo', { status: 'todo' });

    const result = await startTask(project, 1, undefined, undefined, true);
    expect(result.success).toBe(true);
    expect(findLsFilesCall()).toBeUndefined();
  });
});
