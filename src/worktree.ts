/**
 * Git worktree management functions
 * Creates isolated worktrees for CLI agents to work without affecting the main branch
 */

import { execSync, exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

const execAsync = promisify(exec);

export interface WorktreeInfo {
  path: string;
  branch: string;
  createdAt: string;
}

export interface WorktreeCreateResult {
  success: boolean;
  worktree?: WorktreeInfo;
  error?: string;
}

export interface WorktreeRemoveResult {
  success: boolean;
  error?: string;
}

/**
 * Get the worktree directory for a project
 */
export function getWorktreeBaseDir(projectName: string): string {
  return path.join(os.homedir(), 'Ouijit', 'worktrees', projectName);
}

/**
 * Dependency directories to copy from source project to worktree
 */
const DEPENDENCY_DIRS = [
  'node_modules',  // Node.js
  '.venv',         // Python (common convention)
  'venv',          // Python (alternative)
];

/**
 * Copy dependency directories from source project to worktree
 * This avoids needing to run npm install, pip install, etc. in the new worktree
 * Uses shell cp -R which is more reliable for large directories with symlinks
 * Runs asynchronously to avoid blocking the main process
 */
async function copyDependencies(sourcePath: string, worktreePath: string): Promise<void> {
  const copyPromises: Promise<void>[] = [];

  for (const dir of DEPENDENCY_DIRS) {
    const sourceDir = path.join(sourcePath, dir);
    const destDir = path.join(worktreePath, dir);

    // Check if directory exists before attempting copy
    const copyPromise = fs.stat(sourceDir).then(async (stat) => {
      if (stat.isDirectory()) {
        try {
          // Use shell cp with APFS cloning for instant, space-efficient copies
          // -R: recursive, handles symlinks properly
          // -p: preserve timestamps and permissions
          // -c: use APFS clones (copy-on-write) - nearly instant, zero disk space until modified
          await execAsync(`cp -Rpc "${sourceDir}" "${destDir}"`);
        } catch (error) {
          // Log error for debugging but don't fail the worktree creation
          console.warn(`[worktree] Failed to copy ${dir}:`, error instanceof Error ? error.message : error);
        }
      }
    }).catch(() => {
      // Directory doesn't exist, skip silently
    });

    copyPromises.push(copyPromise);
  }

  // Wait for all copies to complete in parallel
  await Promise.all(copyPromises);
}

/**
 * Sanitize a name to be git-branch-safe
 */
function sanitizeBranchName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')      // spaces to hyphens
    .replace(/[^a-z0-9-]/g, '') // remove invalid chars
    .replace(/-+/g, '-')        // collapse multiple hyphens
    .replace(/^-|-$/g, '');     // trim leading/trailing hyphens
}

/**
 * Generate a unique branch name for a worktree
 */
function generateBranchName(name?: string): string {
  if (name) {
    const sanitized = sanitizeBranchName(name);
    if (sanitized) {
      return `${sanitized}-${Date.now()}`;
    }
  }
  return `agent-${Date.now()}`;
}

/**
 * Format a branch name for display (hyphens to spaces, title case)
 */
export function formatBranchNameForDisplay(branch: string): string {
  // Check if it's an old-style agent-timestamp branch
  const agentMatch = branch.match(/^agent-(\d+)$/);
  if (agentMatch) {
    const timestamp = parseInt(agentMatch[1], 10);
    const date = new Date(timestamp);
    return `Untitled ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  }

  // Check if it's a named branch with timestamp suffix
  const namedMatch = branch.match(/^(.+)-\d+$/);
  if (namedMatch) {
    return namedMatch[1].replace(/-/g, ' ');
  }

  // Fallback: just replace hyphens with spaces
  return branch.replace(/-/g, ' ');
}

/**
 * Create a new git worktree for a project
 */
export async function createWorktree(projectPath: string, name?: string): Promise<WorktreeCreateResult> {
  try {
    const projectName = path.basename(projectPath);
    const branch = generateBranchName(name);
    const baseDir = getWorktreeBaseDir(projectName);
    const worktreePath = path.join(baseDir, branch);

    // Ensure base directory exists
    await fs.mkdir(baseDir, { recursive: true });

    // Create worktree with new branch
    execSync(`git worktree add -b "${branch}" "${worktreePath}"`, {
      cwd: projectPath,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Copy dependencies from source project to avoid needing to reinstall
    await copyDependencies(projectPath, worktreePath);

    return {
      success: true,
      worktree: {
        path: worktreePath,
        branch,
        createdAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create worktree',
    };
  }
}

/**
 * Remove a git worktree
 */
export async function removeWorktree(
  projectPath: string,
  worktreePath: string
): Promise<WorktreeRemoveResult> {
  try {
    // Get the branch name before removing
    const branchName = path.basename(worktreePath);

    // Remove the worktree
    execSync(`git worktree remove "${worktreePath}" --force`, {
      cwd: projectPath,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Delete the branch
    try {
      execSync(`git branch -D "${branchName}"`, {
        cwd: projectPath,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      // Branch may already be deleted, ignore
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to remove worktree',
    };
  }
}

/**
 * List all worktrees for a project
 */
export function listWorktrees(projectPath: string): WorktreeInfo[] {
  try {
    const projectName = path.basename(projectPath);
    const baseDir = getWorktreeBaseDir(projectName);

    const output = execSync('git worktree list --porcelain', {
      cwd: projectPath,
      encoding: 'utf8',
    });

    const worktrees: WorktreeInfo[] = [];
    const entries = output.split('\n\n').filter(Boolean);

    for (const entry of entries) {
      const lines = entry.split('\n');
      const worktreeLine = lines.find(l => l.startsWith('worktree '));
      const branchLine = lines.find(l => l.startsWith('branch '));

      if (worktreeLine && branchLine) {
        const wtPath = worktreeLine.replace('worktree ', '');

        // Only include worktrees in our managed directory
        if (wtPath.startsWith(baseDir)) {
          const branch = branchLine.replace('branch refs/heads/', '');
          worktrees.push({
            path: wtPath,
            branch,
            createdAt: '', // Could stat the directory for mtime
          });
        }
      }
    }

    // Sort by timestamp in branch name (newest first)
    worktrees.sort((a, b) => {
      const tsA = a.branch.match(/-(\d{10,})$/)?.[1] || '0';
      const tsB = b.branch.match(/-(\d{10,})$/)?.[1] || '0';
      return parseInt(tsB, 10) - parseInt(tsA, 10);
    });

    return worktrees;
  } catch {
    return [];
  }
}
