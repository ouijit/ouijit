/**
 * Creates a new project directory with git init and CLAUDE.md scaffold.
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { CreateProjectOptions, CreateProjectResult } from './types';
import { getLogger } from './logger';

const creatorLog = getLogger().scope('projectCreator');

export type ValidateFolderResult = { ok: true } | { ok: false; error: string };

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
    return { ok: false, error: error instanceof Error ? error.message : 'Folder not found' };
  }
  if (!stat.isDirectory()) {
    return { ok: false, error: 'Path is not a directory' };
  }
  try {
    await fs.access(path.join(folderPath, '.git'));
  } catch {
    return {
      ok: false,
      error: 'Selected folder is not a git repository. Run `git init` or pick another folder.',
    };
  }
  return { ok: true };
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
