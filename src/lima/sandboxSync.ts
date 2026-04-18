/**
 * Sandbox-view worktree lifecycle and sync.
 *
 * A sandboxed task gets two git worktrees:
 *   - the user worktree (~/Ouijit/worktrees/<proj>/T-N on the user's
 *     branch), which holds the user's real .env, node_modules/, etc.
 *   - a sandbox-view worktree (~/Ouijit/sandbox-views/<proj>/T-N on
 *     child branch s/<user-branch>), which `git worktree add` populates
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
import { createHash } from 'node:crypto';
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

/**
 * The sandbox branch lives under the `s/` namespace prefixed by the
 * user's branch name: `s/feat-foo`. Using `/` puts all sandbox
 * branches in their own namespace in `git branch` output and avoids
 * ref-name collisions with the user's branch.
 */
export function getSandboxBranchName(userBranch: string): string {
  return `s/${userBranch}`;
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
 * Forks branch `s/<user-branch>` from the user's branch tip.
 */
export async function startSandboxView(
  projectPath: string,
  taskNumber: number,
  userWorktreeBranch: string,
): Promise<SandboxViewInfo> {
  const projectName = path.basename(projectPath);
  const baseDir = getSandboxViewBaseDir(projectName);
  const viewPath = getSandboxViewPath(projectName, taskNumber);
  const branch = getSandboxBranchName(userWorktreeBranch);

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
export async function stopSandboxView(
  projectPath: string,
  taskNumber: number,
  userWorktreeBranch: string,
): Promise<void> {
  const projectName = path.basename(projectPath);
  const viewPath = getSandboxViewPath(projectName, taskNumber);
  const branch = getSandboxBranchName(userWorktreeBranch);

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
export async function ffMergeSandboxToUser(userWorktreePath: string, userWorktreeBranch: string): Promise<MergeResult> {
  const sandboxBranch = getSandboxBranchName(userWorktreeBranch);

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
    syncLog.info('ff-merged sandbox branch into user worktree', {
      userWorktreeBranch,
      from: userHead,
      to: sandboxHead,
    });
    return { ok: true, ffMerged: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/fast-forward|non-fast-forward|Not possible to fast-forward/i.test(message)) {
      syncLog.warn('sandbox branch diverged from user branch', { userWorktreeBranch });
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
export function watchSandboxRef(projectPath: string, userWorktreeBranch: string, onUpdate: () => void): () => void {
  const branch = getSandboxBranchName(userWorktreeBranch);
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
          userWorktreeBranch,
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
          userWorktreeBranch,
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

// ── Git integrity watcher ────────────────────────────────────────────

export interface GitIntegritySnapshot {
  /** filename → sha256 of the hook file's contents */
  hooks: Record<string, string>;
  /** Full content of .git/config */
  config: string;
}

export interface GitHooksDelta {
  added: string[];
  modified: string[];
  removed: string[];
}

export interface GitConfigDelta {
  addedLines: string[];
  removedLines: string[];
}

export interface GitIntegrityDelta {
  hooks?: GitHooksDelta;
  config?: GitConfigDelta;
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

export async function snapshotGitIntegrity(projectPath: string): Promise<GitIntegritySnapshot> {
  const gitDir = path.join(projectPath, '.git');
  const hooksDir = path.join(gitDir, 'hooks');
  const configPath = path.join(gitDir, 'config');

  const hooks: Record<string, string> = {};
  const entries = await fs.readdir(hooksDir).catch((): string[] => []);
  await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(hooksDir, entry);
      const stat = await fs.stat(full).catch((): null => null);
      if (!stat?.isFile()) return;
      const content = await fs.readFile(full).catch((): Buffer | null => null);
      if (!content) return;
      hooks[entry] = sha256(content);
    }),
  );

  const config = await fs.readFile(configPath, 'utf8').catch(() => '');

  return { hooks, config };
}

function diffHooks(a: Record<string, string>, b: Record<string, string>): GitHooksDelta | undefined {
  const added: string[] = [];
  const modified: string[] = [];
  const removed: string[] = [];
  for (const name of Object.keys(b)) {
    if (!(name in a)) added.push(name);
    else if (a[name] !== b[name]) modified.push(name);
  }
  for (const name of Object.keys(a)) {
    if (!(name in b)) removed.push(name);
  }
  if (added.length === 0 && modified.length === 0 && removed.length === 0) return undefined;
  return { added, modified, removed };
}

function diffConfig(a: string, b: string): GitConfigDelta | undefined {
  if (a === b) return undefined;
  const aLines = new Set(a.split('\n'));
  const bLines = new Set(b.split('\n'));
  const addedLines: string[] = [];
  const removedLines: string[] = [];
  for (const line of bLines) if (!aLines.has(line)) addedLines.push(line);
  for (const line of aLines) if (!bLines.has(line)) removedLines.push(line);
  if (addedLines.length === 0 && removedLines.length === 0) return undefined;
  return { addedLines, removedLines };
}

function computeIntegrityDelta(
  baseline: GitIntegritySnapshot,
  current: GitIntegritySnapshot,
): GitIntegrityDelta | undefined {
  const hooks = diffHooks(baseline.hooks, current.hooks);
  const config = diffConfig(baseline.config, current.config);
  if (!hooks && !config) return undefined;
  return { ...(hooks && { hooks }), ...(config && { config }) };
}

const INTEGRITY_DEBOUNCE_MS = 200;

/**
 * Watch `.git/hooks/` and `.git/config` for tampering while the sandbox is live.
 * Fires `onDelta` whenever either diverges from `baseline`. The baseline is not
 * updated in place — every alert is relative to the state at sandbox start, so
 * the user sees the full cumulative change. Caller debounces noisy UI.
 */
export function watchGitIntegrity(
  projectPath: string,
  baseline: GitIntegritySnapshot,
  onDelta: (delta: GitIntegrityDelta) => void,
): () => void {
  const gitDir = path.join(projectPath, '.git');
  const hooksDir = path.join(gitDir, 'hooks');
  const configPath = path.join(gitDir, 'config');

  let timer: NodeJS.Timeout | null = null;
  let lastSignature: string | null = null;

  const check = async () => {
    try {
      const current = await snapshotGitIntegrity(projectPath);
      const delta = computeIntegrityDelta(baseline, current);
      if (!delta) return;
      const signature = JSON.stringify(delta);
      if (signature === lastSignature) return;
      lastSignature = signature;
      onDelta(delta);
    } catch (error) {
      syncLog.warn('git integrity check failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const fire = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void check();
    }, INTEGRITY_DEBOUNCE_MS);
  };

  const watchers: FSWatcher[] = [];
  const tryWatch = (target: string) => {
    try {
      const w = watch(target, () => fire());
      w.on('error', (error) => {
        syncLog.warn('git integrity watcher error', {
          target,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      watchers.push(w);
    } catch {
      // Target may not exist (e.g. `hooks/` absent in a bare repo). Non-fatal.
    }
  };

  tryWatch(hooksDir);
  tryWatch(configPath);

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
