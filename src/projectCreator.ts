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

    // Initialize git
    try {
      execSync('git init', { cwd: projectPath, stdio: 'ignore' });
    } catch (gitError) {
      creatorLog.warn('failed to initialize git', {
        error: gitError instanceof Error ? gitError.message : String(gitError),
      });
      // Continue anyway - git init failing shouldn't block project creation
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
