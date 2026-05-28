/**
 * Creates a new project directory with git init and CLAUDE.md scaffold.
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { CreateProjectOptions, CreateProjectResult, ValidateFolderFailureReason } from './types';
import { getLogger } from './logger';

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
function gitIdentityConfigured(cwd: string): boolean {
  try {
    const name = execSync('git config user.name', { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    const email = execSync('git config user.email', { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    return name.length > 0 && email.length > 0;
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
    execSync('git init', { cwd: folderPath, stdio: 'ignore' });
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
      execSync('git add -A', { cwd: folderPath, stdio: 'ignore' });
      // Prefer the user's configured identity; fall back to a neutral one only
      // when git has none, so first-time users still get a commit instead of an
      // "Author identity unknown" failure.
      const hasIdentity = gitIdentityConfigured(folderPath);
      const identityFlags = hasIdentity ? '' : '-c user.name="Ouijit" -c user.email="noreply@ouijit.dev" ';
      execSync(`git ${identityFlags}commit -m "Initial commit"`, { cwd: folderPath, stdio: 'ignore' });
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

export async function createProject(options: CreateProjectOptions): Promise<CreateProjectResult> {
  try {
    const projectsDir = path.join(os.homedir(), 'Ouijit', 'projects');
    const projectPath = path.join(projectsDir, options.name);

    // Validate name doesn't escape the projects directory (e.g. via ../)
    if (!path.resolve(projectPath).startsWith(path.resolve(projectsDir) + path.sep)) {
      return { success: false, error: 'Invalid project name' };
    }

    // Check if project already exists
    try {
      await fs.access(projectPath);
      return { success: false, error: 'A project with this name already exists' };
    } catch {
      // Directory doesn't exist, which is what we want
    }

    // Ensure the projects directory exists
    await fs.mkdir(projectsDir, { recursive: true });

    // Create the project directory
    await fs.mkdir(projectPath);

    // Initialize git — required. If this fails, roll back the directory.
    try {
      execSync('git init', { cwd: projectPath, stdio: 'ignore' });
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

    // Create CLAUDE.md
    const claudeMdContent = `# ${options.name}

## Project Overview

<!-- Describe your project here -->

## Development Guidelines

<!-- Add guidelines for Claude to follow -->
`;
    await fs.writeFile(path.join(projectPath, 'CLAUDE.md'), claudeMdContent, 'utf-8');

    return { success: true, projectPath };
  } catch (error) {
    creatorLog.error('failed to create project', { error: error instanceof Error ? error.message : String(error) });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}
