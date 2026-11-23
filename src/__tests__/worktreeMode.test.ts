import { describe, test, expect, vi, beforeEach } from 'vitest';
import { createTask, setGlobalSetting } from '../db';

import { createTaskWorktree, recoverTaskWorktree } from '../worktree';
import { beginTask } from '../taskLifecycle';
import { execFile as execFileMockedRaw } from 'node:child_process';
import { gitArgs } from './fakeExecFile';

// A branch named bare does not exist yet, so a start takes the -b path; one named
// in full does, so a recovery has a branch to recover from.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const { fakeExecFile } = await import('./fakeExecFile');
  return {
    ...actual,
    execSync: vi.fn(),
    execFile: fakeExecFile((args) =>
      args.includes('--verify') && !args.some((a) => a.startsWith('refs/heads/')) ? new Error('not found') : 'main\n',
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

const execMocked = vi.mocked(execFileMockedRaw);

function findLsFilesCall(): unknown[] | undefined {
  return execMocked.mock.calls.find(([, args]) => gitArgs(args ?? [])[0] === 'ls-files') as unknown[] | undefined;
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

    const result = await createTaskWorktree(project, 'Clean task', undefined, undefined);
    expect(result.success).toBe(true);
    expect(findLsFilesCall()).toBeUndefined();
  });

  test('runs git ls-files when project mode is quick-start (explicit)', async () => {
    const project = '/test/wt-mode-create-quick';
    await setMode(project, 'quick-start');

    const result = await createTaskWorktree(project, 'Quick task', undefined, undefined);
    expect(result.success).toBe(true);
    expect(findLsFilesCall()).toBeDefined();
  });

  test('runs git ls-files by default when no mode is set', async () => {
    const project = '/test/wt-mode-create-default';

    const result = await createTaskWorktree(project, 'Default task', undefined, undefined);
    expect(result.success).toBe(true);
    expect(findLsFilesCall()).toBeDefined();
  });

  test('falls back to copy when stored mode JSON is malformed', async () => {
    const project = '/test/wt-mode-create-garbage';
    await setGlobalSetting(`worktree:${project}`, '{not valid json');

    const result = await createTaskWorktree(project, 'Garbage task', undefined, undefined);
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
