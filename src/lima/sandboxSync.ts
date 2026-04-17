/**
 * Sandbox-view worktree lifecycle and sync.
 *
 * A sandboxed task gets two git worktrees:
 *   - the user worktree (~/Ouijit/worktrees/<proj>/T-N on branch T-N),
 *     which holds the user's real .env, node_modules/, etc.
 *   - a sandbox-view worktree (~/Ouijit/sandbox-views/<proj>/T-N on
 *     child branch T-N-sandbox), which `git worktree add` populates
 *     with tracked files only. No gitignored content ever lives here,
 *     so it's safe to mount into the Lima guest.
 *
 * When the agent commits inside the VM, it commits on the sandbox
 * branch. A host-side fs.watch on the ref file catches the update and
 * fast-forwards the user worktree so the commits appear on the user's
 * branch — the common case is indistinguishable from the old shared-
 * mount behavior. If the user has also committed in parallel, ff-only
 * fails and the caller surfaces a "diverged" affordance in the UI.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import { watch, type FSWatcher } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { getLogger } from '../logger';

const syncLog = getLogger().scope('sandboxSync');

const execFileAsync = promisify(execFile);

const DEBOUNCE_MS = 100;

export function getSandboxViewBaseDir(projectName: string): string {
  return path.join(os.homedir(), 'Ouijit', 'sandbox-views', projectName);
}

export function getSandboxBranchName(taskNumber: number): string {
  return `T-${taskNumber}-sandbox`;
}

export function getSandboxViewPath(projectName: string, taskNumber: number): string {
  return path.join(getSandboxViewBaseDir(projectName), `T-${taskNumber}`);
}

export interface SandboxViewInfo {
  path: string;
  branch: string;
}

/**
 * Create (or reuse) the sandbox-view worktree for a task.
 * Forks branch `T-N-sandbox` from the user's branch tip.
 */
export async function startSandboxView(
  projectPath: string,
  taskNumber: number,
  userWorktreeBranch: string,
): Promise<SandboxViewInfo> {
  const projectName = path.basename(projectPath);
  const baseDir = getSandboxViewBaseDir(projectName);
  const viewPath = getSandboxViewPath(projectName, taskNumber);
  const branch = getSandboxBranchName(taskNumber);

  await fs.mkdir(baseDir, { recursive: true });

  // Prune any stale worktree registration that refers to this path.
  await execFileAsync('git', ['worktree', 'prune'], { cwd: projectPath });

  // Idempotent: if the directory already exists with the right branch checked
  // out, treat it as already started. This covers app restart / PTY respawn.
  const alreadyExists = await fs.access(viewPath).then(
    () => true,
    () => false,
  );
  if (alreadyExists) {
    syncLog.info('sandbox view already exists, reusing', { taskNumber, viewPath, branch });
    return { path: viewPath, branch };
  }

  const branchExists = await execFileAsync('git', ['rev-parse', '--verify', branch], { cwd: projectPath }).then(
    () => true,
    () => false,
  );

  const args = branchExists
    ? ['worktree', 'add', viewPath, branch]
    : ['worktree', 'add', '-b', branch, viewPath, userWorktreeBranch];

  await execFileAsync('git', args, { cwd: projectPath });
  syncLog.info('sandbox view created', { taskNumber, viewPath, branch });
  return { path: viewPath, branch };
}

/**
 * Remove the sandbox-view worktree and delete its branch.
 * Best-effort — logs but does not throw on individual failures.
 */
export async function stopSandboxView(projectPath: string, taskNumber: number): Promise<void> {
  const projectName = path.basename(projectPath);
  const viewPath = getSandboxViewPath(projectName, taskNumber);
  const branch = getSandboxBranchName(taskNumber);

  try {
    await execFileAsync('git', ['worktree', 'remove', viewPath, '--force'], { cwd: projectPath });
  } catch (error) {
    syncLog.warn('worktree remove failed', {
      taskNumber,
      viewPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    await execFileAsync('git', ['branch', '-D', branch], { cwd: projectPath });
  } catch {
    // Branch may already be gone; swallow.
  }

  // Clean up the leaf directory if git didn't (force removal can leave an
  // empty dir around on some platforms). Ignore non-empty / missing cases.
  await fs.rm(viewPath, { force: true, recursive: true }).catch(() => {});
}

export type MergeResult =
  | { ok: true; ffMerged: boolean }
  | { ok: false; reason: 'non-ff'; error: string }
  | { ok: false; reason: 'other'; error: string };

/**
 * Fast-forward the user worktree to the sandbox branch.
 * Returns `{ ok: false, reason: 'non-ff' }` if divergence prevents it.
 */
export async function ffMergeSandboxToUser(userWorktreePath: string, taskNumber: number): Promise<MergeResult> {
  const sandboxBranch = getSandboxBranchName(taskNumber);

  // Skip when nothing new exists on the sandbox branch. Saves a merge attempt
  // and avoids emitting divergence events on every ref-touch.
  let userHead = '';
  let sandboxHead = '';
  try {
    [userHead, sandboxHead] = await Promise.all([
      execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: userWorktreePath }).then((r) => r.stdout.trim()),
      execFileAsync('git', ['rev-parse', sandboxBranch], { cwd: userWorktreePath }).then((r) => r.stdout.trim()),
    ]);
  } catch (error) {
    return { ok: false, reason: 'other', error: error instanceof Error ? error.message : String(error) };
  }

  if (userHead === sandboxHead) {
    return { ok: true, ffMerged: false };
  }

  try {
    await execFileAsync('git', ['merge', '--ff-only', sandboxBranch], { cwd: userWorktreePath });
    syncLog.info('ff-merged sandbox branch into user worktree', { taskNumber, from: userHead, to: sandboxHead });
    return { ok: true, ffMerged: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/fast-forward|non-fast-forward|Not possible to fast-forward/i.test(message)) {
      syncLog.warn('sandbox branch diverged from user branch', { taskNumber });
      return { ok: false, reason: 'non-ff', error: message };
    }
    return { ok: false, reason: 'other', error: message };
  }
}

/**
 * Watch the sandbox branch ref for updates. Calls `onUpdate` (debounced)
 * whenever git commits move the ref. Returns a disposer.
 *
 * Falls back to watching `.git/packed-refs` if the loose ref is absent
 * (which happens after `git gc` or when the branch was just created as
 * a packed ref on first commit).
 */
export function watchSandboxRef(projectPath: string, taskNumber: number, onUpdate: () => void): () => void {
  const branch = getSandboxBranchName(taskNumber);
  const looseRefPath = path.join(projectPath, '.git', 'refs', 'heads', branch);
  const packedRefsPath = path.join(projectPath, '.git', 'packed-refs');

  let timer: NodeJS.Timeout | null = null;
  const fire = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      try {
        onUpdate();
      } catch (error) {
        syncLog.warn('sandbox ref update handler threw', {
          taskNumber,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, DEBOUNCE_MS);
  };

  const watchers: FSWatcher[] = [];

  const tryWatch = (target: string) => {
    try {
      const w = watch(target, (eventType) => {
        if (eventType === 'change' || eventType === 'rename') fire();
      });
      w.on('error', (error) => {
        syncLog.warn('sandbox ref watcher error', {
          taskNumber,
          target,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      watchers.push(w);
      return true;
    } catch {
      return false;
    }
  };

  const looseOk = tryWatch(looseRefPath);
  if (!looseOk) {
    // Ref not materialized yet — watch packed-refs as a fallback so we
    // still catch the first commit. We intentionally fire on every
    // packed-refs change; the ff-merge is a no-op when nothing advanced.
    tryWatch(packedRefsPath);
  }

  return () => {
    if (timer) clearTimeout(timer);
    for (const w of watchers) {
      try {
        w.close();
      } catch {
        // Ignore cleanup errors.
      }
    }
  };
}
