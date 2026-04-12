import { describe, test, expect, vi, beforeEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as realFs from 'node:fs';
import { createTask, getTaskByNumber } from '../db';

// Mock child_process so git commands don't actually run — except for
// `git ls-files -o -i` calls from listMaskedPaths, which delegate to the
// real execFile so tests can enumerate gitignored paths in real temp repos.
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
        file: string,
        args: string[],
        opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void,
      ) => {
        // Delegate listMaskedPaths' git ls-files call to the real binary.
        if (
          file === 'git' &&
          Array.isArray(args) &&
          args.includes('ls-files') &&
          args.includes('-i') &&
          args.includes('--exclude-standard')
        ) {
          return actual.execFile(file, args, opts as Parameters<typeof actual.execFile>[2], cb);
        }
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
import { listMaskedPaths, buildOverlayBindMountSetup, buildOverlayCleanup } from '../lima/overlay';
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

describe('listMaskedPaths', () => {
  const tmpRoot = realFs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-mask-'));

  async function loadRealCp(): Promise<typeof import('node:child_process')> {
    return await vi.importActual<typeof import('node:child_process')>('node:child_process');
  }

  async function initRepo(name: string, files: Record<string, string>): Promise<string> {
    const dir = path.join(tmpRoot, name);
    realFs.mkdirSync(dir, { recursive: true });
    const realCp = await loadRealCp();
    realCp.execSync('git init -q', { cwd: dir });
    realCp.execSync('git config user.email test@test.example', { cwd: dir });
    realCp.execSync('git config user.name test', { cwd: dir });
    for (const [rel, contents] of Object.entries(files)) {
      const full = path.join(dir, rel);
      realFs.mkdirSync(path.dirname(full), { recursive: true });
      realFs.writeFileSync(full, contents);
    }
    return dir;
  }

  test('returns [] for a non-repo directory', async () => {
    const dir = path.join(tmpRoot, 'not-a-repo');
    realFs.mkdirSync(dir, { recursive: true });
    expect(await listMaskedPaths(dir)).toEqual([]);
  });

  test('returns [] when .gitignore matches nothing on disk', async () => {
    const dir = await initRepo('empty-matches', { '.gitignore': 'node_modules\n' });
    expect(await listMaskedPaths(dir)).toEqual([]);
  });

  test('collapses a populated ignored directory to a single dir entry', async () => {
    const dir = await initRepo('dir-collapse', {
      '.gitignore': 'node_modules\n',
      'node_modules/a/index.js': '',
      'node_modules/b/index.js': '',
    });
    expect(await listMaskedPaths(dir)).toEqual([{ relPath: 'node_modules', type: 'directory' }]);
  });

  test('detects a gitignored file at the repo root', async () => {
    const dir = await initRepo('file-root', { '.gitignore': '.env\n', '.env': 'SECRET=1' });
    expect(await listMaskedPaths(dir)).toEqual([{ relPath: '.env', type: 'file' }]);
  });

  test('detects a gitignored file at a nested path', async () => {
    const dir = await initRepo('file-nested', {
      '.gitignore': 'config/secrets.yml\n',
      'config/secrets.yml': 'token: abc',
      'config/keep.yml': 'ok: true',
    });
    const result = await listMaskedPaths(dir);
    expect(result).toContainEqual({ relPath: 'config/secrets.yml', type: 'file' });
    expect(result.find((m) => m.relPath === 'config/keep.yml')).toBeUndefined();
  });

  test('honors negations (!keep.env is excluded from masks)', async () => {
    const dir = await initRepo('negation', {
      '.gitignore': '*.env\n!keep.env\n',
      'secret.env': 'x',
      'keep.env': 'y',
    });
    const result = await listMaskedPaths(dir);
    expect(result).toContainEqual({ relPath: 'secret.env', type: 'file' });
    expect(result.find((m) => m.relPath === 'keep.env')).toBeUndefined();
  });

  test('honors nested .gitignore files', async () => {
    const dir = await initRepo('nested-gitignore', {
      '.gitignore': '',
      'sub/.gitignore': 'local.log\n',
      'sub/local.log': 'logs',
    });
    const result = await listMaskedPaths(dir);
    expect(result).toContainEqual({ relPath: 'sub/local.log', type: 'file' });
  });

  test('expands globs (*.pem)', async () => {
    const dir = await initRepo('glob', {
      '.gitignore': '*.pem\n',
      'a.pem': '',
      'b.pem': '',
    });
    const result = await listMaskedPaths(dir);
    const pems = result.filter((m) => m.relPath.endsWith('.pem'));
    expect(pems.map((m) => m.relPath).sort()).toEqual(['a.pem', 'b.pem']);
    expect(pems.every((m) => m.type === 'file')).toBe(true);
  });
});

describe('buildOverlayBindMountSetup', () => {
  test('returns empty string when masks is empty', () => {
    expect(buildOverlayBindMountSetup({ worktreePath: '/w', taskId: 1, masks: [] })).toBe('');
  });

  test('emits bash with taskId and worktree quoted', () => {
    const script = buildOverlayBindMountSetup({
      worktreePath: "/w with 'quote",
      taskId: 42,
      masks: [
        { relPath: 'node_modules', type: 'directory' },
        { relPath: '.venv', type: 'directory' },
      ],
    });
    expect(script).toContain("TASK='42'");
    expect(script).toContain("WORKTREE='/w with '\\''quote'");
    expect(script).toContain('d node_modules');
    expect(script).toContain('d .venv');
    expect(script).toContain('mount --bind');
    expect(script).toContain('OUIJIT_MASKS_EOF');
  });

  test('emits both d and f prefixes in the mask heredoc', () => {
    const script = buildOverlayBindMountSetup({
      worktreePath: '/w',
      taskId: 1,
      masks: [
        { relPath: 'node_modules', type: 'directory' },
        { relPath: '.env', type: 'file' },
        { relPath: 'config/secrets.yml', type: 'file' },
      ],
    });
    expect(script).toContain('d node_modules');
    expect(script).toContain('f .env');
    expect(script).toContain('f config/secrets.yml');
  });

  test('file-mask branch touches overlay and target placeholders', () => {
    const script = buildOverlayBindMountSetup({
      worktreePath: '/w',
      taskId: 1,
      masks: [{ relPath: '.env', type: 'file' }],
    });
    expect(script).toContain('sudo touch "$overlay" "$target"');
    expect(script).toContain('sudo mkdir -p "$(dirname "$overlay")" "$(dirname "$target")"');
  });

  test('writes .paths sidecar (not .dirs) for cleanup', () => {
    const script = buildOverlayBindMountSetup({
      worktreePath: '/w',
      taskId: 1,
      masks: [{ relPath: 'node_modules', type: 'directory' }],
    });
    expect(script).toContain('"$OVERLAY_ROOT/.paths"');
    expect(script).not.toContain('"$OVERLAY_ROOT/.dirs"');
  });

  test('does NOT use a trap (would not survive exec bash)', () => {
    const script = buildOverlayBindMountSetup({
      worktreePath: '/w',
      taskId: 1,
      masks: [{ relPath: 'node_modules', type: 'directory' }],
    });
    expect(script).not.toContain('trap ');
  });

  test('does NOT use set -e (overlay setup must be best-effort)', () => {
    const script = buildOverlayBindMountSetup({
      worktreePath: '/w',
      taskId: 1,
      masks: [{ relPath: 'node_modules', type: 'directory' }],
    });
    expect(script).not.toMatch(/^set -e/m);
  });

  test('script passes `bash -n` with mixed file + dir masks', async () => {
    const realCp = await vi.importActual<typeof import('node:child_process')>('node:child_process');
    const script = buildOverlayBindMountSetup({
      worktreePath: "/w with 'quote and $danger",
      taskId: 7,
      masks: [
        { relPath: 'node_modules', type: 'directory' },
        { relPath: '.venv', type: 'directory' },
        { relPath: 'target', type: 'directory' },
        { relPath: '.env', type: 'file' },
        { relPath: 'config/secrets.yml', type: 'file' },
      ],
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

  test('reads stashed worktree path and paths sidecar files', () => {
    const script = buildOverlayCleanup(13);
    expect(script).toContain('$OVERLAY_ROOT/.worktree');
    expect(script).toContain('$OVERLAY_ROOT/.paths');
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
