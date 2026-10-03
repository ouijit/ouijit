import { describe, test, expect, vi, beforeEach } from 'vitest';
import { createTask } from '../db';

import { createTaskWorktree, recoverTaskWorktree } from '../worktree';
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

function findLsFilesCall(): unknown[] | undefined {
  return execMocked.mock.calls.find(
    (call) => typeof call[0] === 'string' && (call[0] as string).includes('git ls-files'),
  ) as unknown[] | undefined;
}

beforeEach(() => {
  execMocked.mockClear();
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
