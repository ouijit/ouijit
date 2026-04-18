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
  const projectPath = '/Users/dev/projects/my-project';
  const gitDir = path.join(projectPath, '.git');

  test('mounts sandbox-views RW, .git RO, and targeted .git subdirs RW — no project source', () => {
    const mounts = buildProjectMounts(projectPath);

    // Mount by hostPath for assertion convenience.
    const by = new Map(mounts.map((m) => [m.hostPath, m]));

    // The sandbox-views dir is RW so the agent can materialize and write
    // the dual worktree.
    const sandboxViewsDir = path.join('/tmp/fake-home', 'Ouijit', 'sandbox-views', 'my-project');
    expect(by.get(sandboxViewsDir)?.writable).toBe(true);

    // The project's .git is mounted RO as the base. Reads resolve through
    // this mount for config, hooks, info, HEAD, packed-refs.
    expect(by.get(gitDir)?.writable).toBe(false);

    // Only the subpaths the agent must write to during commit/fetch are
    // RW overlays. Everything else under .git stays RO via the base mount.
    expect(by.get(path.join(gitDir, 'objects'))?.writable).toBe(true);
    expect(by.get(path.join(gitDir, 'refs'))?.writable).toBe(true);
    expect(by.get(path.join(gitDir, 'logs'))?.writable).toBe(true);
    expect(by.get(path.join(gitDir, 'worktrees'))?.writable).toBe(true);

    // The guest must not see the project source root itself — that's
    // where gitignored secrets (.env etc.) live.
    expect(by.has(projectPath)).toBe(false);

    // Nor the regular worktrees dir, which holds the user-worktree's
    // gitignored files (node_modules for the host arch, .env copies, etc.).
    expect(by.has(path.join('/tmp/fake-home', 'Ouijit', 'worktrees', 'my-project'))).toBe(false);
  });

  test('does not expose .git/hooks, .git/config, or .git/info as writable', () => {
    const mounts = buildProjectMounts(projectPath);
    const writablePaths = mounts.filter((m) => m.writable).map((m) => m.hostPath);

    // Hooks: if they were guest-writable the agent could plant a
    // post-merge script that executes on the host during auto-ff-merge.
    expect(writablePaths).not.toContain(path.join(gitDir, 'hooks'));

    // Config: core.fsmonitor / core.sshCommand / core.editor / filter.*
    // drivers all execute arbitrary commands during host-side git use.
    expect(writablePaths).not.toContain(path.join(gitDir, 'config'));

    // info/attributes: registers filter drivers per-path. Same RCE class
    // as config; must stay read-only from the guest.
    expect(writablePaths).not.toContain(path.join(gitDir, 'info'));
  });

  test('host paths equal guest paths so git metadata resolves verbatim', () => {
    const mounts = buildProjectMounts(projectPath);
    for (const m of mounts) {
      expect(m.guestPath).toBe(m.hostPath);
    }
  });
});
