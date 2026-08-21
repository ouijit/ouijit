import { describe, test, expect, vi, beforeEach } from 'vitest';
import { createTask } from '../db';
import { registerSandboxProvider, _resetSandboxRegistryForTesting } from '../sandbox/registry';
import type { SessionOwnerSandboxProvider } from '../sandbox/provider';

import { createTaskWorktree, recoverTaskWorktree, removeTaskWorktree } from '../worktree';
import { beginTask } from '../taskLifecycle';
import { exec as execMockedRaw } from 'node:child_process';

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

const execMocked = vi.mocked(execMockedRaw);

// removeTaskWorktree routes per-task cleanup through every registered provider's
// cleanupTaskResources (Lima's stopSandboxView) — the backend is a per-terminal
// choice, not stored on the task, so cleanup asks each provider. Register a fake
// Lima provider whose cleanup is a spy to keep the real Lima/node-pty graph out.
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

// Sandboxing is per terminal, not per task, so worktrees are always full
// in-place checkouts (gitignored files copied) — no backend-conditional skip.
describe('worktree ignored-file copy', () => {
  test('createTaskWorktree copies ignored files (runs git ls-files)', async () => {
    const project = '/test/worktree-create-copies';
    const result = await createTaskWorktree(project, 'A task');
    expect(result.success).toBe(true);
    expect(findLsFilesCall()).toBeDefined();
  });

  test('beginTask copies ignored files', async () => {
    const project = '/test/worktree-begin-copies';
    await createTask(project, 1, 'A todo', { status: 'todo' });
    const result = await beginTask(project, 1);
    expect(result.success).toBe(true);
    expect(findLsFilesCall()).toBeDefined();
  });

  test('recoverTaskWorktree copies ignored files', async () => {
    const project = '/test/worktree-recover-copies';
    await createTask(project, 7, 'Recovered', {
      branch: 'feat/recover',
      status: 'in_progress',
      worktreePath: '/old/path',
    });
    const result = await recoverTaskWorktree(project, 7);
    expect(result.success).toBe(true);
    expect(findLsFilesCall()).toBeDefined();
  });
});

describe('removeTaskWorktree provider cleanup', () => {
  test('asks every registered provider to clean up a task with a branch', async () => {
    const project = '/test/worktree-remove';
    await createTask(project, 4, 'Delete me', { branch: 'feat/del', worktreePath: '/worktrees/T-4' });

    const result = await removeTaskWorktree(project, '/worktrees/T-4', 4);
    expect(result.success).toBe(true);
    expect(cleanupTaskResources).toHaveBeenCalledTimes(1);
    expect(cleanupTaskResources).toHaveBeenCalledWith(project, 4, 'feat/del');
  });

  test('swallows provider cleanup errors so the delete still succeeds', async () => {
    cleanupTaskResources.mockRejectedValueOnce(new Error('git worktree not found'));
    const project = '/test/worktree-remove-error';
    await createTask(project, 9, 'Delete err', { branch: 'feat/err', worktreePath: '/worktrees/T-9' });

    const result = await removeTaskWorktree(project, '/worktrees/T-9', 9);
    expect(result.success).toBe(true);
  });
});
