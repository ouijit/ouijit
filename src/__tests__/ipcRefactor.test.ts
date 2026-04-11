/**
 * Tests for the IPC refactor: async listWorktrees/shipWorktree conversions,
 * path traversal validation, and taskLifecycle await propagation.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import * as os from 'node:os';
import { createTask, _resetCacheForTesting } from '../db';

// ── Mocks (superset needed by all describe blocks) ──────────────────

vi.mock('node:child_process', () => {
  const execFileFn = vi.fn(
    (_file: string, _args: string[], _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) => {
      cb(null, '', '');
    },
  );
  // Replicate Node's custom promisify for execFile so promisify() returns { stdout, stderr }
  (execFileFn as Record<symbol, unknown>)[Symbol.for('nodejs.util.promisify.custom')] = (
    ...args: unknown[]
  ): Promise<{ stdout: string; stderr: string }> =>
    new Promise((resolve, reject) => {
      execFileFn(...(args as Parameters<typeof execFileFn>), (err: Error | null, stdout: string, stderr: string) => {
        if (err) reject(err);
        else resolve({ stdout, stderr });
      });
    });
  return { exec: vi.fn(), execSync: vi.fn(), execFile: execFileFn };
});

vi.mock('koffi', () => ({
  default: { load: vi.fn() },
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    mkdir: vi.fn(async () => undefined),
    access: vi.fn(async () => {
      throw new Error('ENOENT');
    }),
    writeFile: vi.fn(async () => undefined),
  };
});

vi.mock('../git', () => ({
  mergeWorktreeBranch: vi.fn(() => ({ success: true, mergedBranch: 'feature-1' })),
}));

vi.mock('../hookRunner', () => ({
  executeHook: vi.fn(async () => ({ success: true, output: '' })),
}));

// ── Imports (after mocks) ───────────────────────────────────────────

import { execFile } from 'node:child_process';
import { listWorktrees, shipWorktree } from '../worktree';
import { createProject } from '../projectCreator';
import { getTasksWithWorkspaces } from '../taskLifecycle';

// ── Helpers ─────────────────────────────────────────────────────────

const homedir = os.homedir();
const baseDir = `${homedir}/Ouijit/worktrees/myproject`;

function mockExecFile(handler: (cmd: string) => { stdout: string; stderr: string } | Error) {
  vi.mocked(execFile).mockImplementation(((...args: unknown[]) => {
    const file = args[0] as string;
    const fileArgs = args[1] as string[];
    const cb = args[args.length - 1] as (err: Error | null, stdout: string, stderr: string) => void;
    const cmd = [file, ...fileArgs].join(' ');
    const result = handler(cmd);
    if (result instanceof Error) {
      cb(result, '', '');
    } else {
      cb(null, result.stdout, result.stderr);
    }
  }) as typeof execFile);
}

// ── listWorktrees ───────────────────────────────────────────────────

describe('listWorktrees (async)', () => {
  beforeEach(() => {
    vi.mocked(execFile).mockReset();
  });

  test('returns a Promise (not a synchronous value)', () => {
    mockExecFile(() => ({ stdout: '', stderr: '' }));
    const result = listWorktrees('/projects/myproject');
    expect(result).toBeInstanceOf(Promise);
  });

  test('parses porcelain output and filters to managed worktrees', async () => {
    const porcelain = [
      `worktree /projects/myproject`,
      `HEAD abc123`,
      `branch refs/heads/main`,
      ``,
      `worktree ${baseDir}/T-1`,
      `HEAD def456`,
      `branch refs/heads/feature-1`,
      ``,
      `worktree /some/unmanaged/worktree`,
      `HEAD ghi789`,
      `branch refs/heads/other`,
      ``,
      `worktree ${baseDir}/T-2`,
      `HEAD jkl012`,
      `branch refs/heads/feature-2`,
    ].join('\n');

    mockExecFile(() => ({ stdout: porcelain, stderr: '' }));

    const worktrees = await listWorktrees('/projects/myproject');
    expect(worktrees).toHaveLength(2);
    expect(worktrees[0].path).toBe(`${baseDir}/T-1`);
    expect(worktrees[0].branch).toBe('feature-1');
    expect(worktrees[1].path).toBe(`${baseDir}/T-2`);
    expect(worktrees[1].branch).toBe('feature-2');
  });

  test('returns empty array when git command fails', async () => {
    mockExecFile(() => new Error('fatal: not a git repository'));
    const worktrees = await listWorktrees('/not-a-repo');
    expect(worktrees).toEqual([]);
  });

  test('returns empty array when no managed worktrees exist', async () => {
    const porcelain = [`worktree /projects/myproject`, `HEAD abc123`, `branch refs/heads/main`].join('\n');

    mockExecFile(() => ({ stdout: porcelain, stderr: '' }));
    const worktrees = await listWorktrees('/projects/myproject');
    expect(worktrees).toEqual([]);
  });

  test('sorts by timestamp in branch name (newest first)', async () => {
    const porcelain = [
      `worktree ${baseDir}/T-1`,
      `HEAD abc`,
      `branch refs/heads/older-1000000000`,
      ``,
      `worktree ${baseDir}/T-2`,
      `HEAD def`,
      `branch refs/heads/newer-2000000000`,
    ].join('\n');

    mockExecFile(() => ({ stdout: porcelain, stderr: '' }));
    const worktrees = await listWorktrees('/projects/myproject');
    expect(worktrees[0].branch).toBe('newer-2000000000');
    expect(worktrees[1].branch).toBe('older-1000000000');
  });
});

// ── shipWorktree ────────────────────────────────────────────────────

describe('shipWorktree (async)', () => {
  beforeEach(() => {
    vi.mocked(execFile).mockReset();
  });

  const worktreePorcelain = (branch: string) =>
    [`worktree ${baseDir}/T-1`, `HEAD def456`, `branch refs/heads/${branch}`].join('\n');

  test('detects uncommitted changes and returns error', async () => {
    const branch = 'dirty-branch';
    mockExecFile((cmd) => {
      if (cmd.includes('git worktree list')) return { stdout: worktreePorcelain(branch), stderr: '' };
      if (cmd.includes('git status --porcelain')) return { stdout: ' M dirty-file.ts\n', stderr: '' };
      return { stdout: '', stderr: '' };
    });

    await createTask('/projects/myproject', 1, 'Dirty task', { branch, mergeTarget: 'main' });

    const result = await shipWorktree('/projects/myproject', branch);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Uncommitted changes');
  });

  test('proceeds with merge when worktree is clean', async () => {
    const branch = 'clean-branch';
    mockExecFile((cmd) => {
      if (cmd.includes('git worktree list')) return { stdout: worktreePorcelain(branch), stderr: '' };
      if (cmd.includes('git status --porcelain')) return { stdout: '', stderr: '' };
      return { stdout: '', stderr: '' };
    });

    await createTask('/projects/myproject', 2, 'Clean task', { branch, mergeTarget: 'main' });

    const result = await shipWorktree('/projects/myproject', branch);
    expect(result.success).toBe(true);
  });

  test('proceeds with merge when worktree is not found', async () => {
    mockExecFile(() => ({ stdout: '', stderr: '' }));
    await createTask('/projects/myproject', 3, 'Orphan task', { branch: 'orphan-branch', mergeTarget: 'main' });

    const result = await shipWorktree('/projects/myproject', 'orphan-branch');
    expect(result.success).toBe(true);
  });
});

// ── createProject path traversal ────────────────────────────────────

describe('createProject path traversal', () => {
  test('rejects names with ../ path traversal', async () => {
    const result = await createProject({ name: '../../../etc/evil' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid project name');
  });

  test('rejects names with embedded .. components', async () => {
    const result = await createProject({ name: 'legit/../../../etc/passwd' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid project name');
  });

  test('rejects bare ..', async () => {
    const result = await createProject({ name: '..' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid project name');
  });

  test('allows normal project names', async () => {
    const result = await createProject({ name: 'my-project' });
    expect(result.success).toBe(true);
    expect(result.projectPath).toContain('my-project');
  });

  test('allows names with dots that are not traversal', async () => {
    const result = await createProject({ name: 'my.project.v2' });
    expect(result.success).toBe(true);
    expect(result.projectPath).toContain('my.project.v2');
  });
});

// ── getTasksWithWorkspaces (await propagation) ──────────────────────

describe('getTasksWithWorkspaces', () => {
  beforeEach(() => {
    vi.mocked(execFile).mockReset();
    _resetCacheForTesting();
  });

  test('resolves worktree path from live git data, not stale metadata', async () => {
    const project = '/projects/myproject';
    const livePath = `${baseDir}/T-1`;

    // Return a worktree list that maps feature-1 → livePath
    mockExecFile(() => {
      const porcelain = [
        `worktree /projects/myproject`,
        `HEAD abc123`,
        `branch refs/heads/main`,
        ``,
        `worktree ${livePath}`,
        `HEAD def456`,
        `branch refs/heads/feature-1`,
      ].join('\n');
      return { stdout: porcelain, stderr: '' };
    });

    // Create a task whose stored worktreePath differs from the live worktree
    await createTask(project, 1, 'Test task', {
      branch: 'feature-1',
      worktreePath: '/stale/old/path',
    });

    const tasks = await getTasksWithWorkspaces(project);

    expect(tasks).toHaveLength(1);
    // Must resolve to the LIVE worktree path, not the stale stored path.
    // If the `await` on listWorktrees were missing, this would be '/stale/old/path'.
    expect(tasks[0].worktreePath).toBe(livePath);
    expect(tasks[0].branch).toBe('feature-1');
  });
});
