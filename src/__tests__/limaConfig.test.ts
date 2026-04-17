import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import { buildProjectMounts } from '../lima/config';

let prevHome: string | undefined;

beforeEach(() => {
  prevHome = process.env.HOME;
  process.env.HOME = '/tmp/fake-home';
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
});

describe('buildProjectMounts', () => {
  test('mounts the project .git dir and the sandbox-views base dir — no project source', () => {
    const projectPath = '/Users/dev/projects/my-project';
    const mounts = buildProjectMounts(projectPath);

    expect(mounts).toHaveLength(2);
    const hostPaths = mounts.map((m) => m.hostPath);
    expect(hostPaths).toContain(path.join(projectPath, '.git'));
    expect(hostPaths).toContain(path.join('/tmp/fake-home', 'Ouijit', 'sandbox-views', 'my-project'));

    // The guest must not see the project source root itself — that's where
    // gitignored secrets (.env etc.) live.
    expect(hostPaths).not.toContain(projectPath);

    // Nor the regular worktrees dir, which holds the user-worktree's
    // gitignored files (node_modules for the host arch, .env copies, etc.).
    expect(hostPaths).not.toContain(path.join('/tmp/fake-home', 'Ouijit', 'worktrees', 'my-project'));
  });

  test('both mounts are writable so the agent can commit', () => {
    const mounts = buildProjectMounts('/Users/dev/projects/my-project');
    for (const m of mounts) {
      expect(m.writable).toBe(true);
    }
  });

  test('host paths equal guest paths so git metadata resolves verbatim', () => {
    const mounts = buildProjectMounts('/Users/dev/projects/my-project');
    for (const m of mounts) {
      expect(m.guestPath).toBe(m.hostPath);
    }
  });
});
