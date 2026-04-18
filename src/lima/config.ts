import * as os from 'node:os';
import * as path from 'node:path';
import type { LimaMount } from './types';
import { getSandboxViewBaseDir } from './sandboxSync';

/**
 * Build mounts for a project's Lima VM.
 *
 * The guest only ever runs sandboxed tasks. The mount layout isolates
 * gitignored host content (never mounts the project source or the user's
 * worktree) and denies guest-writable access to the bits of `.git` that
 * would let an agent plant host-side RCE — specifically `.git/hooks/`
 * and `.git/config`, which git executes during commands the user later
 * runs on the host (`git status`, `git commit`, ff-merge, etc.).
 *
 * Layout:
 *   RW sandbox-views/<proj>       — the dual worktree lives here
 *   RO <project>/.git             — base mount; config/hooks/info read-only
 *   RW <project>/.git/objects     — agent needs to write pack objects on commit
 *   RW <project>/.git/refs        — loose ref updates (per-branch HEAD moves)
 *   RW <project>/.git/logs        — common reflogs appended on every commit
 *   RW <project>/.git/worktrees   — per-worktree HEAD/logs for the sandbox view
 *
 * Linux VFS resolves writes through the deepest mount point, so the RW
 * subdirs act as writable overlays on top of the RO base. Everything
 * not covered by an RW overlay (hooks/, config, info/, packed-refs,
 * HEAD) stays RO and guest writes fail with EROFS. Reflogs under
 * `.git/logs/` are append-only text with no code-execution path, so
 * exposing them RW doesn't reintroduce the hooks/config RCE class.
 */
export function buildProjectMounts(projectPath: string): LimaMount[] {
  const projectName = path.basename(projectPath);
  const sandboxViewsBaseDir = getSandboxViewBaseDir(projectName);
  const projectGitDir = path.join(projectPath, '.git');

  return [
    {
      hostPath: sandboxViewsBaseDir,
      guestPath: sandboxViewsBaseDir,
      writable: true,
    },
    {
      hostPath: projectGitDir,
      guestPath: projectGitDir,
      writable: false,
    },
    {
      hostPath: path.join(projectGitDir, 'objects'),
      guestPath: path.join(projectGitDir, 'objects'),
      writable: true,
    },
    {
      hostPath: path.join(projectGitDir, 'refs'),
      guestPath: path.join(projectGitDir, 'refs'),
      writable: true,
    },
    {
      hostPath: path.join(projectGitDir, 'logs'),
      guestPath: path.join(projectGitDir, 'logs'),
      writable: true,
    },
    {
      hostPath: path.join(projectGitDir, 'worktrees'),
      guestPath: path.join(projectGitDir, 'worktrees'),
      writable: true,
    },
  ];
}

/**
 * Expand ~ to the user's home directory
 */
export function expandHome(p: string): string {
  if (p.startsWith('~/')) {
    return os.homedir() + p.slice(1);
  }
  return p;
}
