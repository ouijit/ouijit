import { describe, test, expect, vi, beforeEach } from 'vitest';
import { createTask } from '../db';

import { createTaskWorktree, recoverTaskWorktree } from '../worktree';
import { beginTask } from '../taskLifecycle';
import { execFile as execFileMockedRaw } from 'node:child_process';
import { gitArgs } from './fakeExecFile';

// Mock child_process so git commands don't actually run.
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
