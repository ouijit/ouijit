/**
 * One-time removal of the state the deleted Lima sandbox backend registered
 * inside the user's git repos, plus its own config files.
 *
 * The per-task teardown that used to remove a sandbox view went with the
 * feature, so without this `git worktree list` keeps showing sandbox views
 * nothing can prune, on branches nothing will delete.
 *
 * Deliberately not removed: the VM homes under `~/.ouijit/` (gigabytes of
 * Ubuntu disk images). Deleting that much of a user's data unprompted is their
 * call, and `rm -rf ~/.ouijit` is a thing they can do for themselves — unlike
 * a worktree registration buried in a repo's `.git`.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { getAllProjects, getGlobalSetting, setGlobalSetting } from '../db';
import { getUserDataPath } from '../paths';
import { getLogger } from '../logger';

const leftoverLog = getLogger().scope('limaLeftovers');

const execFileAsync = promisify(execFile);

const DONE_KEY = 'lima-leftovers-removed';

/** Where `src/lima/sandboxSync.ts` put its dual worktrees, keyed by project basename. */
const sandboxViewsRoot = (): string => path.join(os.homedir(), 'Ouijit', 'sandbox-views');

const sandboxConfigsDir = (): string => path.join(getUserDataPath(), 'sandbox-configs');

interface SandboxViewRegistration {
  worktreePath: string;
  branch?: string;
}

/**
 * Prefixes a sandbox view's registered path can start with. git resolves
 * symlinks when it records a worktree, so on a relocated or symlinked home the
 * stored path won't match `os.homedir()` — but a root that has already been
 * deleted by hand can't be resolved at all, which is exactly the case where
 * the registrations still need pruning. Match either spelling.
 */
async function sandboxViewPrefixes(): Promise<string[]> {
  const root = sandboxViewsRoot();
  const candidates = new Set([root]);
  try {
    candidates.add(await fs.realpath(root));
  } catch {
    /* already gone — the literal path is all we have */
  }
  return Array.from(candidates, (dir) => `${dir}${path.sep}`);
}

/**
 * Sandbox-view worktrees registered in one repo, read from git rather than
 * guessed from the branch name: a branch is deleted below only because a
 * worktree we are removing had it checked out, so a branch the user happens to
 * have named under `s/` is never touched.
 */
async function findSandboxViews(projectPath: string, prefixes: string[]): Promise<SandboxViewRegistration[]> {
  const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], {
    cwd: projectPath,
    encoding: 'utf8',
  });

  const views: SandboxViewRegistration[] = [];
  let current: SandboxViewRegistration | null = null;

  // Porcelain output is stanzas separated by blank lines, each opening with
  // `worktree <path>` and optionally carrying `branch refs/heads/<name>`.
  for (const line of stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      const worktreePath = line.slice('worktree '.length);
      current = prefixes.some((p) => worktreePath.startsWith(p)) ? { worktreePath } : null;
      if (current) views.push(current);
    } else if (current && line.startsWith('branch refs/heads/')) {
      current.branch = line.slice('branch refs/heads/'.length);
    }
  }
  return views;
}

/**
 * Delete a branch the agent committed on. Logs the tip first: if the host-side
 * fast-forward had failed, those commits exist nowhere else, and the SHA is
 * what makes them recoverable until git gc collects them.
 */
async function deleteSandboxBranch(projectPath: string, branch: string): Promise<void> {
  let tip = 'unknown';
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', branch], { cwd: projectPath, encoding: 'utf8' });
    tip = stdout.trim();
  } catch {
    /* already gone */
  }
  await execFileAsync('git', ['branch', '-D', branch], { cwd: projectPath, encoding: 'utf8' });
  leftoverLog.info('deleted sandbox branch', { projectPath, branch, tip });
}

async function cleanProject(projectPath: string, prefixes: string[]): Promise<void> {
  const views = await findSandboxViews(projectPath, prefixes);
  if (views.length === 0) return;

  // Unregister before touching the branches: git refuses to delete a branch
  // that is still checked out in a registered worktree. `remove` handles a view
  // still on disk, `prune` the ones whose directory already went.
  for (const view of views) {
    try {
      await execFileAsync('git', ['worktree', 'remove', view.worktreePath, '--force'], {
        cwd: projectPath,
        encoding: 'utf8',
      });
    } catch {
      /* directory already gone — prune picks the registration up */
    }
  }
  await execFileAsync('git', ['worktree', 'prune'], { cwd: projectPath, encoding: 'utf8' });

  for (const view of views) {
    if (!view.branch) continue;
    try {
      await deleteSandboxBranch(projectPath, view.branch);
    } catch (error) {
      leftoverLog.warn('could not delete sandbox branch', {
        projectPath,
        branch: view.branch,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Runs once per install, at bootstrap. Every step is best-effort and logged: a
 * repo that has moved or a permission error must not stop the rest, and must
 * not keep the app from starting.
 */
export async function removeLimaLeftovers(): Promise<void> {
  if (await getGlobalSetting(DONE_KEY)) return;

  const prefixes = await sandboxViewPrefixes();
  const projects = await getAllProjects();
  for (const project of projects) {
    try {
      await cleanProject(project.path, prefixes);
    } catch (error) {
      leftoverLog.warn('sandbox-view cleanup failed for project', {
        projectPath: project.path,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const dir of [sandboxViewsRoot(), sandboxConfigsDir()]) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (error) {
      leftoverLog.warn('could not remove directory', {
        dir,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await setGlobalSetting(DONE_KEY, new Date().toISOString());
  leftoverLog.info('removed Lima leftovers', { projects: projects.length });
}
