import { describe, test, expect, vi, beforeEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as realFs from 'node:fs';
import { createTask, getTaskByNumber } from '../db';

// Mock child_process so git commands don't actually run.
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
      if (Array.isArray(args) && args.includes('--verify')) {
        cb(new Error('not found'), '', '');
      } else {
        cb(null, '', '');
      }
    },
  ),
}));

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

vi.mock('koffi', () => ({
  default: { load: vi.fn() },
}));

// Mock runInVm so it doesn't try to reach limactl during tests.
const { runInVmMock } = vi.hoisted(() => ({ runInVmMock: vi.fn(async () => undefined) }));
vi.mock('../lima/manager', () => ({
  runInVm: runInVmMock,
}));

import { createTaskWorktree, startTask, recoverTaskWorktree, removeTaskWorktree } from '../worktree';
import { beginTask, createBranchFromTask } from '../taskLifecycle';
import { parseIgnoredDirs, buildOverlayBindMountSetup, buildOverlayCleanup } from '../lima/overlay';
import { exec as execMockedRaw } from 'node:child_process';

const execMocked = vi.mocked(execMockedRaw);

function findLsFilesCall(): unknown[] | undefined {
  return execMocked.mock.calls.find(
    (call) => typeof call[0] === 'string' && (call[0] as string).includes('git ls-files'),
  ) as unknown[] | undefined;
}

beforeEach(() => {
  runInVmMock.mockClear();
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

describe('removeTaskWorktree overlay cleanup', () => {
  test('runs the cleanup script in the VM when task is sandboxed', async () => {
    const project = '/test/sandbox-remove';
    await createTask(project, 4, 'Sandbox delete', {
      branch: 'feat/del',
      worktreePath: '/worktrees/T-4',
      sandboxed: true,
    });

    const result = await removeTaskWorktree(project, '/worktrees/T-4', 4);
    expect(result.success).toBe(true);
    expect(runInVmMock).toHaveBeenCalledTimes(1);
    const [passedProject, passedCmd] = runInVmMock.mock.calls[0] as [string, string];
    expect(passedProject).toBe(project);
    // Cleanup script must umount before rm -rf and target the right task overlay.
    expect(passedCmd).toContain("TASK='4'");
    expect(passedCmd).toContain('/var/lib/ouijit/overlays/T-$TASK');
    expect(passedCmd).toContain('umount');
    expect(passedCmd).toContain('rm -rf "$OVERLAY_ROOT"');
  });

  test('does not call runInVm when task is not sandboxed', async () => {
    const project = '/test/regular-remove';
    await createTask(project, 4, 'Regular delete', {
      branch: 'feat/reg',
      worktreePath: '/worktrees/T-4',
    });

    const result = await removeTaskWorktree(project, '/worktrees/T-4', 4);
    expect(result.success).toBe(true);
    expect(runInVmMock).not.toHaveBeenCalled();
  });

  test('swallows runInVm errors', async () => {
    runInVmMock.mockRejectedValueOnce(new Error('VM not running'));
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

describe('parseIgnoredDirs', () => {
  const tmpRoot = realFs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-parse-'));

  function writeGitignore(name: string, contents: string): string {
    const dir = path.join(tmpRoot, name);
    realFs.mkdirSync(dir, { recursive: true });
    realFs.writeFileSync(path.join(dir, '.gitignore'), contents);
    return dir;
  }

  test('returns [] when .gitignore is missing', async () => {
    const dir = path.join(tmpRoot, 'no-gitignore');
    realFs.mkdirSync(dir, { recursive: true });
    expect(await parseIgnoredDirs(dir)).toEqual([]);
  });

  test('returns [] for an empty .gitignore', async () => {
    const dir = writeGitignore('empty', '');
    expect(await parseIgnoredDirs(dir)).toEqual([]);
  });

  test('accepts common bare directories', async () => {
    const dir = writeGitignore('common', ['node_modules', 'target', 'dist/', '/.venv', ''].join('\n'));
    const result = await parseIgnoredDirs(dir);
    expect(result).toEqual(['node_modules', 'target', 'dist', '.venv']);
  });

  test('rejects globs, negations, nested paths, comments', async () => {
    const dir = writeGitignore(
      'unsupported',
      ['# a comment', '', '*.log', 'build-*', '!keep', 'src/generated/', 'node_modules'].join('\n'),
    );
    expect(await parseIgnoredDirs(dir)).toEqual(['node_modules']);
  });

  test('accepts **/<name> shorthand for a single bare dir', async () => {
    const dir = writeGitignore('recursive', ['**/build', '**/node_modules', '**/nested/dir'].join('\n'));
    expect(await parseIgnoredDirs(dir)).toEqual(['build', 'node_modules']);
  });

  test('dedupes across plain, trailing slash, and **/ forms', async () => {
    const dir = writeGitignore('dedupe', ['node_modules', 'node_modules/', '**/node_modules'].join('\n'));
    expect(await parseIgnoredDirs(dir)).toEqual(['node_modules']);
  });
});

describe('buildOverlayBindMountSetup', () => {
  test('returns empty string when dirs is empty', () => {
    expect(buildOverlayBindMountSetup({ worktreePath: '/w', taskId: 1, dirs: [] })).toBe('');
  });

  test('emits bash with taskId and worktree quoted', () => {
    const script = buildOverlayBindMountSetup({
      worktreePath: "/w with 'quote",
      taskId: 42,
      dirs: ['node_modules', '.venv'],
    });
    expect(script).toContain("TASK='42'");
    expect(script).toContain("WORKTREE='/w with '\\''quote'");
    expect(script).toContain('node_modules');
    expect(script).toContain('.venv');
    expect(script).toContain('mount --bind');
    expect(script).toContain('OUIJIT_IGNORED_DIRS_EOF');
  });

  test('does NOT use a trap (would not survive exec bash)', () => {
    const script = buildOverlayBindMountSetup({ worktreePath: '/w', taskId: 1, dirs: ['node_modules'] });
    expect(script).not.toContain('trap ');
  });

  test('does NOT use set -e (overlay setup must be best-effort)', () => {
    const script = buildOverlayBindMountSetup({ worktreePath: '/w', taskId: 1, dirs: ['node_modules'] });
    expect(script).not.toMatch(/^set -e/m);
  });

  test('script passes `bash -n` syntax check', async () => {
    const realCp = await vi.importActual<typeof import('node:child_process')>('node:child_process');
    const script = buildOverlayBindMountSetup({
      worktreePath: "/w with 'quote and $danger",
      taskId: 7,
      dirs: ['node_modules', '.venv', 'target'],
    });
    expect(() => realCp.execSync('bash -n', { input: script })).not.toThrow();
  });
});

describe('buildOverlayCleanup', () => {
  test('emits bash that removes the per-task overlay root', () => {
    const script = buildOverlayCleanup(13);
    expect(script).toContain("TASK='13'");
    expect(script).toContain('/var/lib/ouijit/overlays/T-$TASK');
    expect(script).toContain('umount');
    expect(script).toContain('rm -rf "$OVERLAY_ROOT"');
  });

  test('reads stashed worktree path and dirs sidecar files', () => {
    const script = buildOverlayCleanup(13);
    expect(script).toContain('$OVERLAY_ROOT/.worktree');
    expect(script).toContain('$OVERLAY_ROOT/.dirs');
  });

  test('falls back to /proc/self/mountinfo for orphaned mounts', () => {
    const script = buildOverlayCleanup(13);
    expect(script).toContain('/proc/self/mountinfo');
  });

  test('script passes `bash -n` syntax check', async () => {
    const realCp = await vi.importActual<typeof import('node:child_process')>('node:child_process');
    const script = buildOverlayCleanup(99);
    expect(() => realCp.execSync('bash -n', { input: script })).not.toThrow();
  });
});
