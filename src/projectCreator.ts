/**
 * Creates a new project directory with git init.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { CreateProjectOptions, CreateProjectResult, ValidateFolderFailureReason } from './types';
import { getDefaultProjectsDir } from './projectsFolder';
import { getLogger } from './logger';

const execFileAsync = promisify(execFile);

const creatorLog = getLogger().scope('projectCreator');

export type ValidateFolderResult = { ok: true } | { ok: false; error: string; reason: ValidateFolderFailureReason };

/**
 * Validates that a user-picked folder is suitable to add as a project:
 * exists, is a directory, and is a git repo. `.git` is a directory in normal
 * repos and a file in worktrees / submodules — fs.access covers both.
 */
export async function validateProjectFolder(folderPath: string): Promise<ValidateFolderResult> {
  let stat;
  try {
    stat = await fs.stat(folderPath);
  } catch (error) {
    return { ok: false, reason: 'not-found', error: error instanceof Error ? error.message : 'Folder not found' };
  }
  if (!stat.isDirectory()) {
    return { ok: false, reason: 'not-a-directory', error: 'Path is not a directory' };
  }
  try {
    await fs.access(path.join(folderPath, '.git'));
  } catch {
    return {
      ok: false,
      reason: 'not-a-git-repo',
      error: 'Selected folder is not a git repository. Run `git init` or pick another folder.',
    };
  }
  return { ok: true };
}

/** True when both git user.name and user.email resolve in this folder's context. */
async function gitIdentityConfigured(cwd: string): Promise<boolean> {
  try {
    const { stdout: name } = await execFileAsync('git', ['config', 'user.name'], { cwd });
    const { stdout: email } = await execFileAsync('git', ['config', 'user.email'], { cwd });
    return name.trim().length > 0 && email.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Initializes a git repository in an existing folder so it can be added as a
 * project. Used to recover from the "not a git repository" dead-end: the user
 * picks a plain folder, we offer to `git init` it in place.
 *
 * `git init` is the essential step. An initial commit is best-effort — if the
 * folder is empty or no git identity is configured, the commit is skipped but
 * the repo is still initialized (the recoverable state we care about).
 */
export async function initGitRepo(
  folderPath: string,
  options: { initialCommit?: boolean } = {},
): Promise<{ success: boolean; error?: string }> {
  let stat;
  try {
    stat = await fs.stat(folderPath);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Folder not found' };
  }
  if (!stat.isDirectory()) {
    return { success: false, error: 'Path is not a directory' };
  }

  try {
    await fs.access(path.join(folderPath, '.git'));
    // Already a repo — nothing to do, treat as success.
    return { success: true };
  } catch {
    // Not a repo yet, proceed to init.
  }

  try {
    await execFileAsync('git', ['init'], { cwd: folderPath });
  } catch (error) {
    creatorLog.error('git init failed', {
      folderPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: 'Could not initialize git. Install via `xcode-select --install` (macOS) or your package manager (Linux).',
    };
  }

  if (options.initialCommit) {
    try {
      await execFileAsync('git', ['add', '-A'], { cwd: folderPath });
      // Prefer the user's configured identity; fall back to a neutral one only
      // when git has none, so first-time users still get a commit instead of an
      // "Author identity unknown" failure.
      const hasIdentity = await gitIdentityConfigured(folderPath);
      const identityFlags = hasIdentity ? [] : ['-c', 'user.name=Ouijit', '-c', 'user.email=noreply@ouijit.dev'];
      await execFileAsync('git', [...identityFlags, 'commit', '-m', 'Initial commit'], { cwd: folderPath });
    } catch (error) {
      // Best-effort: nothing to commit (empty folder). The repo is still
      // initialized, which is all the add-project flow requires.
      creatorLog.warn('initial commit skipped after git init', {
        folderPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { success: true };
}

export type NewProjectPathFailure = 'relative-parent' | 'escapes-parent' | 'taken';

export type ResolvedProjectPath =
  | { ok: true; parentDir: string; projectPath: string }
  | { ok: false; reason: NewProjectPathFailure };

/**
 * Where a project folder named `name` will go, refusing anything that is
 * already occupied or that escapes `parentDir`. Shared by every flow that
 * produces a folder, so the traversal guard has one implementation. The caller
 * words the failure, since only it knows what it is producing.
 */
export async function resolveNewProjectPath(name: string, parentDir: string | undefined): Promise<ResolvedProjectPath> {
  const resolvedParent = parentDir ?? (await getDefaultProjectsDir());
  // A relative parentDir would resolve against the process cwd ('/' when packaged).
  if (!path.isAbsolute(resolvedParent)) return { ok: false, reason: 'relative-parent' };

  const projectPath = path.join(resolvedParent, name);
  if (!path.resolve(projectPath).startsWith(path.resolve(resolvedParent) + path.sep)) {
    return { ok: false, reason: 'escapes-parent' };
  }
  try {
    await fs.access(projectPath);
    return { ok: false, reason: 'taken' };
  } catch {
    return { ok: true, parentDir: resolvedParent, projectPath };
  }
}

const CREATE_PATH_ERRORS: Record<NewProjectPathFailure, string> = {
  'relative-parent': 'The project location must be an absolute path',
  'escapes-parent': 'Invalid project name',
  taken: 'A project with this name already exists',
};

export async function createProject(options: CreateProjectOptions): Promise<CreateProjectResult> {
  try {
    const resolved = await resolveNewProjectPath(options.name, options.parentDir);
    if (resolved.ok === false) return { success: false, error: CREATE_PATH_ERRORS[resolved.reason] };
    const { parentDir: projectsDir, projectPath } = resolved;

    await fs.mkdir(projectsDir, { recursive: true });

    await fs.mkdir(projectPath);

    // Initialize git — required. If this fails, roll back the directory.
    try {
      await execFileAsync('git', ['init'], { cwd: projectPath });
    } catch (gitError) {
      creatorLog.error('failed to initialize git', {
        error: gitError instanceof Error ? gitError.message : String(gitError),
      });
      try {
        await fs.rm(projectPath, { recursive: true, force: true });
      } catch (cleanupErr) {
        creatorLog.warn('failed to clean up after git init failure', {
          error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
        });
      }
      return {
        success: false,
        error: 'Git is required. Install via `xcode-select --install` (macOS) or your package manager (Linux).',
      };
    }

    return { success: true, projectPath };
  } catch (error) {
    creatorLog.error('failed to create project', { error: error instanceof Error ? error.message : String(error) });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}
