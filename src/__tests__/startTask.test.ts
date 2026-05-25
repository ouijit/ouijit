import { describe, test, expect, vi } from 'vitest';
import { createTask, getTaskByNumber } from '../db';

// Mock child_process so execAsync resolves without real git commands
vi.mock('node:child_process', () => ({
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
      // Default: rev-parse --verify always fails (branch doesn't exist) so tests exercise the -b path
      if (Array.isArray(args) && args.includes('--verify')) {
        cb(new Error('not found'), '', '');
      } else {
        cb(null, '', '');
      }
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
    const { execFile } = await import('node:child_process');
    vi.mocked(execFile).mockClear();

    const project = '/test/start-with-base';
    await createTask(project, 1, 'Child task', { status: 'todo' });

    await startTask(project, 1, undefined, 'feat/parent-branch');

    const execFileCalls = vi.mocked(execFile).mock.calls;
    const wtAddCall = execFileCalls.find(
      ([file, args]) => file === 'git' && Array.isArray(args) && args.includes('worktree'),
    );
    expect(wtAddCall).toBeDefined();
    const args = wtAddCall![1] as string[];
    expect(args).toContain('-b');
    expect(args).toContain('feat/parent-branch');
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
    const { execFile } = await import('node:child_process');
    vi.mocked(execFile).mockClear();

    const project = '/test/begin-with-parent';
    await createTask(project, 1, 'Parent', { branch: 'feat/parent', status: 'in_progress' });
    await createTask(project, 2, 'Child', { status: 'todo', parentTaskNumber: 1 });

    await beginTask(project, 2);

    const execFileCalls = vi.mocked(execFile).mock.calls;
    const wtAddCall = execFileCalls.find(
      ([file, args]) => file === 'git' && Array.isArray(args) && args.includes('worktree'),
    );
    expect(wtAddCall).toBeDefined();
    const args = wtAddCall![1] as string[];
    expect(args).toContain('-b');
    expect(args).toContain('feat/parent');
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

  test('concurrent startTask calls do not race to claim the same T-N directory', async () => {
    const { execFile } = await import('node:child_process');
    const fs = await import('node:fs/promises');

    // Stateful mock world: tracks which T-N paths exist. Two tasks start at
    // the same time with T-3 and T-4 already on disk, so both probes climb
    // past them. Without the mutex they would both target T-5 and one git
    // worktree add would fail with "already exists".
    const claimed = new Set(['T-3', 'T-4']);
    const baseOf = (p: string) => p.split('/').pop() ?? '';

    vi.mocked(fs.access).mockImplementation(async (p) => {
      if (claimed.has(baseOf(p as string))) return undefined;
      throw new Error('ENOENT');
    });

    vi.mocked(execFile).mockImplementation(
      (
        _file: string,
        args: readonly string[] | undefined | null,
        _opts: unknown,
        cb?: (err: Error | null, stdout: string, stderr: string) => void,
      ) => {
        const callback = cb!;
        if (Array.isArray(args) && args.includes('--verify')) {
          callback(new Error('not found'), '', '');
          return undefined as never;
        }
        if (Array.isArray(args) && args[0] === 'worktree' && args[1] === 'add') {
          const targetPath = args.find((a) => a.includes('/T-')) ?? '';
          const base = baseOf(targetPath);
          if (claimed.has(base)) {
            callback(new Error(`fatal: '${targetPath}' already exists`), '', '');
          } else {
            claimed.add(base);
            callback(null, '', '');
          }
          return undefined as never;
        }
        callback(null, '', '');
        return undefined as never;
      },
    );

    const project = '/test/start-concurrency';
    await createTask(project, 3, 'Task three', { status: 'todo' });
    await createTask(project, 5, 'Task five', { status: 'todo' });

    const [r3, r5] = await Promise.all([startTask(project, 3), startTask(project, 5)]);

    expect(r3.success).toBe(true);
    expect(r5.success).toBe(true);
    expect(r3.worktreePath).not.toBe(r5.worktreePath);
    // Task 3 enters first, probes past T-3/T-4, claims T-5. Task 5 then
    // enters, probes T-5 (now claimed) and lands at T-6.
    expect(baseOf(r3.worktreePath!)).toBe('T-5');
    expect(baseOf(r5.worktreePath!)).toBe('T-6');
  });
});
