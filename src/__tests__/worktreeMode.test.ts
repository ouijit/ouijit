import { describe, test, expect, vi, beforeEach } from 'vitest';
import { createTask, setGlobalSetting } from '../db';

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

import { createTaskWorktree, recoverTaskWorktree } from '../worktree';
import { beginTask } from '../taskLifecycle';
import { exec as execMockedRaw } from 'node:child_process';

const execMocked = vi.mocked(execMockedRaw);

function findLsFilesCall(): unknown[] | undefined {
  return execMocked.mock.calls.find(
    (call) => typeof call[0] === 'string' && (call[0] as string).includes('git ls-files'),
  ) as unknown[] | undefined;
}

async function setMode(project: string, mode: 'quick-start' | 'clean-checkout'): Promise<void> {
  await setGlobalSetting(`worktree:${project}`, JSON.stringify({ mode }));
}

beforeEach(() => {
  execMocked.mockClear();
});

describe('createTaskWorktree worktree-mode gating', () => {
  test('skips git ls-files when project mode is clean-checkout', async () => {
    const project = '/test/wt-mode-create-clean';
    await setMode(project, 'clean-checkout');

    const result = await createTaskWorktree(project, 'Clean task', undefined, undefined, false);
    expect(result.success).toBe(true);
    expect(findLsFilesCall()).toBeUndefined();
  });

  test('runs git ls-files when project mode is quick-start (explicit)', async () => {
    const project = '/test/wt-mode-create-quick';
    await setMode(project, 'quick-start');

    const result = await createTaskWorktree(project, 'Quick task', undefined, undefined, false);
    expect(result.success).toBe(true);
    expect(findLsFilesCall()).toBeDefined();
  });

  test('runs git ls-files by default when no mode is set', async () => {
    const project = '/test/wt-mode-create-default';

    const result = await createTaskWorktree(project, 'Default task', undefined, undefined, false);
    expect(result.success).toBe(true);
    expect(findLsFilesCall()).toBeDefined();
  });

  test('falls back to copy when stored mode JSON is malformed', async () => {
    const project = '/test/wt-mode-create-garbage';
    await setGlobalSetting(`worktree:${project}`, '{not valid json');

    const result = await createTaskWorktree(project, 'Garbage task', undefined, undefined, false);
    expect(result.success).toBe(true);
    expect(findLsFilesCall()).toBeDefined();
  });
});

describe('beginTask / startTask worktree-mode gating', () => {
  test('skips copy when project mode is clean-checkout', async () => {
    const project = '/test/wt-mode-begin-clean';
    await setMode(project, 'clean-checkout');
    await createTask(project, 1, 'Clean todo', { status: 'todo' });

    const result = await beginTask(project, 1);
    expect(result.success).toBe(true);
    expect(findLsFilesCall()).toBeUndefined();
  });

  test('runs copy when project mode is quick-start', async () => {
    const project = '/test/wt-mode-begin-quick';
    await setMode(project, 'quick-start');
    await createTask(project, 1, 'Quick todo', { status: 'todo' });

    const result = await beginTask(project, 1);
    expect(result.success).toBe(true);
    expect(findLsFilesCall()).toBeDefined();
  });
});

describe('recoverTaskWorktree worktree-mode gating', () => {
  test('skips copy when project mode is clean-checkout', async () => {
    const project = '/test/wt-mode-recover-clean';
    await setMode(project, 'clean-checkout');
    await createTask(project, 3, 'Clean recovery', {
      branch: 'feat/clean-recover',
      status: 'in_progress',
      worktreePath: '/old/path',
    });

    const result = await recoverTaskWorktree(project, 3);
    expect(result.success).toBe(true);
    expect(findLsFilesCall()).toBeUndefined();
  });

  test('runs copy by default', async () => {
    const project = '/test/wt-mode-recover-default';
    await createTask(project, 3, 'Default recovery', {
      branch: 'feat/default-recover',
      status: 'in_progress',
      worktreePath: '/old/path',
    });

    const result = await recoverTaskWorktree(project, 3);
    expect(result.success).toBe(true);
    expect(findLsFilesCall()).toBeDefined();
  });
});
