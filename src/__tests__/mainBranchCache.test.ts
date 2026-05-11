import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock `execFile` from node:child_process so we can count the spawns.
// `promisify(execFile)` produces a function compatible with what git.ts
// stores under `execFileAsync`.
const execFileMock = vi.fn();
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    execFile: (...args: unknown[]) => execFileMock(...args),
  };
});

// Re-import after the mock is registered so git.ts sees the mocked execFile.
const { getMainBranchAsync, invalidateMainBranchCache } = await import('../git');

beforeEach(() => {
  invalidateMainBranchCache();
  execFileMock.mockReset();
});

describe('getMainBranchAsync', () => {
  it('caches the result so subsequent calls do not spawn git', async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, { stdout: '* main\n', stderr: '' });
    });

    const first = await getMainBranchAsync('/repo');
    const second = await getMainBranchAsync('/repo');

    expect(first).toBe('main');
    expect(second).toBe('main');
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to "main" when git fails (and does not cache the failure)', async () => {
    execFileMock.mockImplementationOnce((_cmd, _args, _opts, cb) => {
      cb(new Error('not a git repo'), null);
    });
    expect(await getMainBranchAsync('/repo')).toBe('main');
    expect(execFileMock).toHaveBeenCalledTimes(1);

    // Recovery path: a later call should retry rather than serve a poisoned cache.
    execFileMock.mockImplementationOnce((_cmd, _args, _opts, cb) => {
      cb(null, { stdout: '* master\n', stderr: '' });
    });
    expect(await getMainBranchAsync('/repo')).toBe('master');
    expect(execFileMock).toHaveBeenCalledTimes(2);
  });

  it('prefers main over master when both branches exist', async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, { stdout: '  main\n* master\n', stderr: '' });
    });
    expect(await getMainBranchAsync('/repo')).toBe('main');
  });

  it('dedupes concurrent cold-cache misses to a single git spawn', async () => {
    let resolveExec!: (value: { stdout: string; stderr: string }) => void;
    execFileMock.mockImplementationOnce((_cmd, _args, _opts, cb) => {
      // Defer the callback so both callers race against the same in-flight promise.
      new Promise<{ stdout: string; stderr: string }>((res) => {
        resolveExec = res;
      }).then((v) => cb(null, v));
    });

    const a = getMainBranchAsync('/repo');
    const b = getMainBranchAsync('/repo');
    const c = getMainBranchAsync('/repo');

    // Single spawn so far — all three share the in-flight Promise.
    expect(execFileMock).toHaveBeenCalledTimes(1);

    resolveExec({ stdout: '* main\n', stderr: '' });
    expect(await Promise.all([a, b, c])).toEqual(['main', 'main', 'main']);
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  it('invalidateMainBranchCache forces a fresh spawn', async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, { stdout: '* main\n', stderr: '' });
    });

    await getMainBranchAsync('/repo');
    invalidateMainBranchCache('/repo');
    await getMainBranchAsync('/repo');

    expect(execFileMock).toHaveBeenCalledTimes(2);
  });
});
