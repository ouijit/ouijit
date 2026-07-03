import { describe, test, expect, vi, beforeEach } from 'vitest';
import { createTask, getTaskByNumber } from '../db';
import { registerSandboxProvider, _resetSandboxRegistryForTesting } from '../sandbox/registry';
import type { SessionOwnerSandboxProvider } from '../sandbox/provider';

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

import { createTaskWorktree, startTask, recoverTaskWorktree, removeTaskWorktree } from '../worktree';
import { beginTask, createBranchFromTask } from '../taskLifecycle';
import { exec as execMockedRaw } from 'node:child_process';

const execMocked = vi.mocked(execMockedRaw);

// worktree.ts routes per-task sandbox cleanup through the registered provider's
// cleanupTaskResources (Lima's stopSandboxView). Register a fake Lima provider
// whose cleanup is a spy — this keeps the real Lima/node-pty graph out of the
// unit test while still exercising the registry dispatch.
const cleanupTaskResources = vi.fn(async () => undefined);
const fakeLima = {
  kind: 'session-owner',
  id: 'lima',
  displayName: 'Lima VM',
  capabilities: { vmLifecycle: true, yamlConfig: true, sandboxView: true, profiles: false, network: false },
  isAvailable: async () => true,
  getStatus: async () => ({ providerId: 'lima', available: true, ready: true }),
  cleanupTaskResources,
  cleanup: vi.fn(),
  spawnPty: vi.fn(),
  ownsPty: () => false,
  writePty: vi.fn(),
  resizePty: vi.fn(),
  killPty: vi.fn(),
  setPtyLabel: vi.fn(),
  getActiveSessions: () => [],
  reconnectPty: () => ({ success: true }),
} as unknown as SessionOwnerSandboxProvider;

function findLsFilesCall(): unknown[] | undefined {
  return execMocked.mock.calls.find(
    (call) => typeof call[0] === 'string' && (call[0] as string).includes('git ls-files'),
  ) as unknown[] | undefined;
}

beforeEach(() => {
  cleanupTaskResources.mockClear();
  execMocked.mockClear();
  _resetSandboxRegistryForTesting();
  registerSandboxProvider(fakeLima);
});

describe('createTaskWorktree sandbox behavior', () => {
  test('persists the lima provider on the task row', async () => {
    const project = '/test/sandboxed-create-persists';
    const result = await createTaskWorktree(project, 'Sandboxed task', undefined, undefined, 'lima');
    expect(result.success).toBe(true);
    const task = await getTaskByNumber(project, result.task!.taskNumber);
    expect(task!.sandboxProvider).toBe('lima');
  });

  test('skips git ls-files (and copyGitIgnoredFiles) when lima-sandboxed', async () => {
    const project = '/test/sandboxed-create-skip';
    const result = await createTaskWorktree(project, 'Sandboxed', undefined, undefined, 'lima');
    expect(result.success).toBe(true);
    expect(findLsFilesCall()).toBeUndefined();
  });

  test('still calls git ls-files when not sandboxed (regression guard)', async () => {
    const project = '/test/sandboxed-create-regression';
    const result = await createTaskWorktree(project, 'Normal', undefined, undefined, undefined);
    expect(result.success).toBe(true);
    expect(findLsFilesCall()).toBeDefined();
  });

  test('nono runs in place, so it still copies ignored files (like a host task)', async () => {
    const project = '/test/sandboxed-create-nono';
    const result = await createTaskWorktree(project, 'Nono', undefined, undefined, 'nono');
    expect(result.success).toBe(true);
    const task = await getTaskByNumber(project, result.task!.taskNumber);
    expect(task!.sandboxProvider).toBe('nono');
    expect(findLsFilesCall()).toBeDefined();
  });
});

describe('beginTask sandbox propagation', () => {
  test('forwards task.sandboxProvider into startTask (lima skips copy)', async () => {
    const project = '/test/sandboxed-begin';
    await createTask(project, 1, 'Sandboxed todo', { status: 'todo', sandboxProvider: 'lima' });

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
  test('skips copyGitIgnoredFiles when task is lima-sandboxed', async () => {
    const project = '/test/sandboxed-recover';
    await createTask(project, 7, 'Sandbox recovered', {
      branch: 'feat/sandbox-recover',
      status: 'in_progress',
      sandboxProvider: 'lima',
      worktreePath: '/old/path',
    });

    const result = await recoverTaskWorktree(project, 7);
    expect(result.success).toBe(true);
    expect(findLsFilesCall()).toBeUndefined();
  });
});

describe('createBranchFromTask sandbox inheritance', () => {
  test('child inherits the provider from a sandboxed parent', async () => {
    const project = '/test/sandbox-inherit';
    await createTask(project, 1, 'Sandbox parent', {
      branch: 'feat/parent',
      status: 'in_progress',
      sandboxProvider: 'lima',
    });

    const result = await createBranchFromTask(project, 1, 'Child');
    expect(result.success).toBe(true);
    expect(result.task!.sandboxProvider).toBe('lima');
  });

  test('child of non-sandboxed parent has no provider', async () => {
    const project = '/test/sandbox-inherit-none';
    await createTask(project, 1, 'Regular parent', { branch: 'feat/parent', status: 'in_progress' });

    const result = await createBranchFromTask(project, 1, 'Child');
    expect(result.success).toBe(true);
    expect(result.task!.sandboxProvider).toBeUndefined();
  });
});

describe('removeTaskWorktree sandbox-view cleanup', () => {
  test('invokes the provider cleanup when the task has a sandbox backend', async () => {
    const project = '/test/sandbox-remove';
    await createTask(project, 4, 'Sandbox delete', {
      branch: 'feat/del',
      worktreePath: '/worktrees/T-4',
      sandboxProvider: 'lima',
    });

    const result = await removeTaskWorktree(project, '/worktrees/T-4', 4);
    expect(result.success).toBe(true);
    expect(cleanupTaskResources).toHaveBeenCalledTimes(1);
    expect(cleanupTaskResources).toHaveBeenCalledWith(project, 4, 'feat/del');
  });

  test('does not invoke provider cleanup when task has no sandbox backend', async () => {
    const project = '/test/regular-remove';
    await createTask(project, 4, 'Regular delete', {
      branch: 'feat/reg',
      worktreePath: '/worktrees/T-4',
    });

    const result = await removeTaskWorktree(project, '/worktrees/T-4', 4);
    expect(result.success).toBe(true);
    expect(cleanupTaskResources).not.toHaveBeenCalled();
  });

  test('swallows provider cleanup errors so task delete still succeeds', async () => {
    cleanupTaskResources.mockRejectedValueOnce(new Error('git worktree not found'));
    const project = '/test/sandbox-remove-error';
    await createTask(project, 9, 'Sandbox delete err', {
      branch: 'feat/err',
      worktreePath: '/worktrees/T-9',
      sandboxProvider: 'lima',
    });

    const result = await removeTaskWorktree(project, '/worktrees/T-9', 9);
    expect(result.success).toBe(true);
  });
});

describe('startTask sandbox flag', () => {
  test('lima provider skips ls-files', async () => {
    const project = '/test/start-sandbox';
    await createTask(project, 1, 'Sandbox todo', { status: 'todo' });

    const result = await startTask(project, 1, undefined, undefined, 'lima');
    expect(result.success).toBe(true);
    expect(findLsFilesCall()).toBeUndefined();
  });
});
