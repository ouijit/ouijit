/**
 * Integration tests for the dual-worktree sandbox sync primitives.
 * Uses a real temporary git repo — no mocking of child_process or fs.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import {
  startSandboxView,
  stopSandboxView,
  ffMergeSandboxToUser,
  watchSandboxRef,
  snapshotGitIntegrity,
  watchGitIntegrity,
  getSandboxBranchName,
  getSandboxViewPath,
} from '../../lima/sandboxSync';

let tmpRoot: string;
let prevHome: string | undefined;
let repoDir: string;
let userWt: string;
const USER_BRANCH = 'feat-sync';
const SANDBOX_BRANCH = `s/${USER_BRANCH}`;

function git(cwd: string, ...args: string[]): string {
  return execSync(`git ${args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`, {
    cwd,
    encoding: 'utf8',
  }).trim();
}

async function commitFile(cwd: string, relPath: string, content: string, message: string): Promise<void> {
  await fs.writeFile(path.join(cwd, relPath), content);
  execSync('git add -A', { cwd });
  execSync(`git commit -m "${message}"`, { cwd });
}

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ouijit-sbxsync-'));
  // Redirect ~/Ouijit/... paths used by sandboxSync. os.homedir() reads HOME on
  // POSIX, which is all we support here (the module is only exercised from the
  // Electron main process, which is macOS/Linux only).
  prevHome = process.env.HOME;
  process.env.HOME = tmpRoot;

  repoDir = path.join(tmpRoot, 'project');
  await fs.mkdir(repoDir, { recursive: true });

  execSync('git init -b main', { cwd: repoDir });
  execSync('git config user.email "test@test.com"', { cwd: repoDir });
  execSync('git config user.name "Test"', { cwd: repoDir });
  await commitFile(repoDir, 'README.md', '# initial\n', 'Initial commit');

  // Create the user branch from main's tip, then check out main in the repo
  // so the user worktree owns the branch (same shape as real project mode).
  execSync(`git branch ${USER_BRANCH}`, { cwd: repoDir });
  userWt = path.join(tmpRoot, 'user-wt');
  execSync(`git worktree add "${userWt}" ${USER_BRANCH}`, { cwd: repoDir });
});

afterEach(async () => {
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  // Don't fail teardown if the sandbox tree is still partly mounted.
  await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
});

describe('startSandboxView', () => {
  test('creates a worktree on the s/<user-branch> child branch', async () => {
    const info = await startSandboxView(repoDir, 42, USER_BRANCH);

    expect(info.branch).toBe(SANDBOX_BRANCH);
    expect(info.path).toBe(getSandboxViewPath(path.basename(repoDir), 42));

    // The worktree directory exists and is on the sandbox branch.
    const head = git(info.path, 'rev-parse', '--abbrev-ref', 'HEAD');
    expect(head).toBe(SANDBOX_BRANCH);

    // The sandbox branch was forked from the user branch tip.
    const userHead = git(userWt, 'rev-parse', 'HEAD');
    const sandboxHead = git(info.path, 'rev-parse', 'HEAD');
    expect(sandboxHead).toBe(userHead);
  });

  test('is idempotent when called twice', async () => {
    const first = await startSandboxView(repoDir, 42, USER_BRANCH);
    const second = await startSandboxView(repoDir, 42, USER_BRANCH);
    expect(second.path).toBe(first.path);
    expect(second.branch).toBe(first.branch);
  });
});

describe('stopSandboxView', () => {
  test('removes the worktree and deletes the branch', async () => {
    const info = await startSandboxView(repoDir, 7, USER_BRANCH);
    await stopSandboxView(repoDir, 7, USER_BRANCH);

    const exists = await fs
      .access(info.path)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);

    const branches = execSync('git branch', { cwd: repoDir, encoding: 'utf8' });
    expect(branches).not.toMatch(new RegExp(SANDBOX_BRANCH.replace('/', '\\/')));
  });

  test('is safe to call when nothing exists', async () => {
    await expect(stopSandboxView(repoDir, 999, USER_BRANCH)).resolves.toBeUndefined();
  });
});

describe('ffMergeSandboxToUser', () => {
  test('fast-forwards the user worktree when the sandbox advances', async () => {
    const sandbox = await startSandboxView(repoDir, 1, USER_BRANCH);
    await commitFile(sandbox.path, 'agent.txt', 'hello from agent\n', 'agent work');

    const result = await ffMergeSandboxToUser(userWt, USER_BRANCH);
    expect(result).toEqual({ ok: true, ffMerged: true });

    const userHead = git(userWt, 'rev-parse', 'HEAD');
    const sandboxHead = git(sandbox.path, 'rev-parse', 'HEAD');
    expect(userHead).toBe(sandboxHead);
    const fileExists = await fs
      .access(path.join(userWt, 'agent.txt'))
      .then(() => true)
      .catch(() => false);
    expect(fileExists).toBe(true);
  });

  test('returns non-ff when the branches have diverged', async () => {
    const sandbox = await startSandboxView(repoDir, 2, USER_BRANCH);

    // Parallel commits on both sides produce divergence.
    await commitFile(sandbox.path, 'agent.txt', 'agent change\n', 'agent commit');
    await commitFile(userWt, 'user.txt', 'user change\n', 'user commit');

    const beforeUserHead = git(userWt, 'rev-parse', 'HEAD');
    const result = await ffMergeSandboxToUser(userWt, USER_BRANCH);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('non-ff');

    // User worktree must be untouched.
    expect(git(userWt, 'rev-parse', 'HEAD')).toBe(beforeUserHead);
  });

  test('is a no-op when both branches already point at the same commit', async () => {
    await startSandboxView(repoDir, 3, USER_BRANCH);
    const result = await ffMergeSandboxToUser(userWt, USER_BRANCH);
    expect(result).toEqual({ ok: true, ffMerged: false });
  });

  test('handles a sandbox rewind-then-diverge as non-ff', async () => {
    const sandbox = await startSandboxView(repoDir, 4, USER_BRANCH);
    await commitFile(sandbox.path, 'a.txt', 'a\n', 'commit a');
    await commitFile(sandbox.path, 'b.txt', 'b\n', 'commit b');

    // First ff-merge picks up both commits.
    const first = await ffMergeSandboxToUser(userWt, USER_BRANCH);
    expect(first).toEqual({ ok: true, ffMerged: true });

    // Agent rewinds and then commits a different history — now divergent
    // relative to the user's branch, which still has `b.txt`.
    execSync('git reset --hard HEAD~1', { cwd: sandbox.path });
    await commitFile(sandbox.path, 'c.txt', 'c\n', 'divergent commit');

    const beforeUserHead = git(userWt, 'rev-parse', 'HEAD');
    const second = await ffMergeSandboxToUser(userWt, USER_BRANCH);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe('non-ff');
    expect(git(userWt, 'rev-parse', 'HEAD')).toBe(beforeUserHead);
  });
});

describe('watchSandboxRef', () => {
  test('fires when the sandbox branch receives a commit', async () => {
    const sandbox = await startSandboxView(repoDir, 5, USER_BRANCH);

    const updates: number[] = [];
    const dispose = watchSandboxRef(repoDir, USER_BRANCH, () => {
      updates.push(Date.now());
    });

    try {
      await commitFile(sandbox.path, 'poke.txt', 'poke\n', 'poke');

      // Wait for the debounced watcher to fire (<= ~300ms on macOS FSEvents).
      const deadline = Date.now() + 2000;
      while (updates.length === 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(updates.length).toBeGreaterThan(0);
    } finally {
      dispose();
    }
  });
});

describe('git integrity watcher', () => {
  test('snapshot captures hooks and config baseline', async () => {
    const snap = await snapshotGitIntegrity(repoDir);
    expect(typeof snap.config).toBe('string');
    expect(snap.config.length).toBeGreaterThan(0);
    // git init drops a handful of .sample files in .git/hooks/.
    const hookNames = Object.keys(snap.hooks);
    expect(hookNames.length).toBeGreaterThan(0);
    expect(hookNames.every((n) => n.endsWith('.sample'))).toBe(true);
  });

  test('fires on a new hook file and on .git/config changes', async () => {
    const baseline = await snapshotGitIntegrity(repoDir);
    const events: Array<Parameters<Parameters<typeof watchGitIntegrity>[2]>[0]> = [];
    const dispose = watchGitIntegrity(repoDir, baseline, (d) => events.push(d));

    try {
      // Drop an agent-style malicious hook.
      await fs.writeFile(path.join(repoDir, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n');
      await fs.chmod(path.join(repoDir, '.git', 'hooks', 'pre-commit'), 0o755);

      // Tamper with config too.
      execSync('git config --local core.hooksPath /tmp/evil', { cwd: repoDir });

      const deadline = Date.now() + 3000;
      while (events.length === 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
      }
      // Wait a moment more for both deltas to coalesce.
      await new Promise((r) => setTimeout(r, 300));

      expect(events.length).toBeGreaterThan(0);
      const merged = events.reduce<{ hookAdds: string[]; configAdds: string[] }>(
        (acc, d) => {
          if (d.hooks?.added) acc.hookAdds.push(...d.hooks.added);
          if (d.config?.addedLines) acc.configAdds.push(...d.config.addedLines);
          return acc;
        },
        { hookAdds: [], configAdds: [] },
      );
      expect(merged.hookAdds).toContain('pre-commit');
      expect(merged.configAdds.some((l) => l.includes('/tmp/evil'))).toBe(true);
    } finally {
      dispose();
    }
  });

  test('does not fire when nothing changes', async () => {
    const baseline = await snapshotGitIntegrity(repoDir);
    const events: unknown[] = [];
    const dispose = watchGitIntegrity(repoDir, baseline, (d) => events.push(d));
    try {
      await new Promise((r) => setTimeout(r, 400));
      expect(events.length).toBe(0);
    } finally {
      dispose();
    }
  });
});

describe('branch and path helpers', () => {
  test('getSandboxBranchName prefixes the user branch with s/', () => {
    expect(getSandboxBranchName('feat-foo')).toBe('s/feat-foo');
    expect(getSandboxBranchName('test-env-sandbox-1')).toBe('s/test-env-sandbox-1');
  });

  test('getSandboxViewPath lives under ~/Ouijit/sandbox-views/<project>/', () => {
    const p = getSandboxViewPath('my-proj', 8);
    expect(p).toBe(path.join(tmpRoot, 'Ouijit', 'sandbox-views', 'my-proj', 'T-8'));
  });
});
