/**
 * Git worktree management functions
 * Creates isolated worktrees for CLI agents to work without affecting the main branch
 */

import { execSync, exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { getNextTaskNumber, createTask, getTaskByNumber, deleteTaskByNumber, type TaskMetadata } from './taskMetadata';
import { getHook } from './projectSettings';
import { executeHook } from './hookRunner';

const execAsync = promisify(exec);

const MAX_ERROR_LENGTH = 500;

export interface WorktreeInfo {
  path: string;
  branch: string;
  taskName?: string;
  createdAt: string;
}

export interface TaskWorktreeResult {
  success: boolean;
  task?: TaskMetadata;
  worktreePath?: string;
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
 * Escape a path for use in shell commands
 */
function shellEscape(str: string): string {
  return `'${str.replace(/'/g, "'\\''")}'`;
}

/**
 * Copy all gitignored files from source project to worktree
 * This ensures secrets, local configs, dependencies, and other untracked files are available
 * Uses APFS clones for instant, space-efficient copies
 */
async function copyGitIgnoredFiles(sourcePath: string, worktreePath: string): Promise<void> {
  try {
    // Get list of ignored files/directories from git
    // --others: untracked files
    // --ignored: only show ignored files
    // --exclude-standard: use .gitignore, .git/info/exclude, global gitignore
    // --directory: show directory names instead of their contents (efficient for copying whole dirs)
    const { stdout } = await execAsync(
      'git ls-files --others --ignored --exclude-standard --directory',
      { cwd: sourcePath, maxBuffer: 10 * 1024 * 1024 } // 10MB buffer for large lists
    );

    const items = stdout.split('\n').filter(item => item.trim());
    if (items.length === 0) return;

    // Copy each item in parallel
    const copyPromises = items.map(async (item) => {
      // Remove trailing slash if present (directories)
      const cleanItem = item.replace(/\/$/, '');
      if (!cleanItem) return;

      const sourceItem = path.join(sourcePath, cleanItem);
      const destItem = path.join(worktreePath, cleanItem);

      try {
        const stat = await fs.stat(sourceItem);

        // Ensure parent directory exists
        await fs.mkdir(path.dirname(destItem), { recursive: true });

        if (stat.isDirectory()) {
          // Use APFS clone for directories (fast, space-efficient)
          // -R: recursive, -p: preserve timestamps/permissions, -c: APFS clone
          await execAsync(`cp -Rpc ${shellEscape(sourceItem)} ${shellEscape(destItem)}`);
        } else {
          // Use APFS clone for files too
          await execAsync(`cp -pc ${shellEscape(sourceItem)} ${shellEscape(destItem)}`);
        }
      } catch (error) {
        // Log but don't fail - some files might be transient or locked
        console.warn(`[worktree] Failed to copy ${cleanItem}:`, error instanceof Error ? error.message : error);
      }
    });

    await Promise.all(copyPromises);
  } catch (error) {
    // Log but don't fail worktree creation if git ls-files fails
    console.warn('[worktree] Failed to copy gitignored files:', error instanceof Error ? error.message : error);
  }
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
 * Generate a branch name from a task name
 * Always includes task number to guarantee uniqueness
 */
function generateBranchName(name: string | undefined, taskNumber: number): string {
  if (name) {
    const sanitized = sanitizeBranchName(name);
    if (sanitized) {
      return `${sanitized}-${taskNumber}`;
    }
  }
  return `task-${taskNumber}`;
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
 * Create a new task with its git worktree
 * This is the main entry point - combines task metadata and worktree creation
 */
export async function createTaskWorktree(projectPath: string, name?: string): Promise<TaskWorktreeResult> {
  try {
    // Check if repo has any commits (worktrees require a valid HEAD)
    try {
      execSync('git rev-parse HEAD', {
        cwd: projectPath,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      // No commits yet - create an initial empty commit
      execSync('git commit --allow-empty -m "Initial commit"', {
        cwd: projectPath,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    }

    const projectName = path.basename(projectPath);
    const displayName = name || 'Untitled';

    // Get next task number (only persisted after successful worktree creation)
    const taskNumber = await getNextTaskNumber(projectPath);

    // Generate branch name and worktree path
    const branch = generateBranchName(name, taskNumber);
    const baseDir = getWorktreeBaseDir(projectName);
    const worktreePath = path.join(baseDir, `T-${taskNumber}`);

    // Ensure base directory exists
    await fs.mkdir(baseDir, { recursive: true });

    // Create worktree with new branch
    execSync(`git worktree add -b "${branch}" "${worktreePath}"`, {
      cwd: projectPath,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Create task metadata (worktree succeeded)
    const task = await createTask(projectPath, taskNumber, branch, displayName);

    // Copy all gitignored files (secrets, configs, dependencies, etc.)
    await copyGitIgnoredFiles(projectPath, worktreePath);

    // Run init hook if configured
    const initHook = await getHook(projectPath, 'init');
    if (initHook) {
      const hookResult = await executeHook(initHook, worktreePath, {
        projectPath,
        worktreePath,
        taskBranch: branch,
        taskName: displayName,
      });

      if (!hookResult.success) {
        // Rollback: remove worktree and delete task metadata
        try {
          execSync(`git worktree remove "${worktreePath}" --force`, {
            cwd: projectPath,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
          });
        } catch {
          // Ignore cleanup errors
        }

        try {
          execSync(`git branch -D "${branch}"`, {
            cwd: projectPath,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
          });
        } catch {
          // Ignore cleanup errors
        }

        await deleteTaskByNumber(projectPath, taskNumber);

        // Truncate output if too large
        const truncatedOutput = hookResult.output && hookResult.output.length > MAX_ERROR_LENGTH
          ? hookResult.output.slice(0, MAX_ERROR_LENGTH) + '... (truncated)'
          : hookResult.output;

        return {
          success: false,
          error: `Init hook failed: ${hookResult.error || truncatedOutput || 'Unknown error'}`,
        };
      }
    }

    return {
      success: true,
      task,
      worktreePath,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create task worktree',
    };
  }
}

/**
 * Remove a git worktree and its task metadata
 */
export async function removeTaskWorktree(
  projectPath: string,
  worktreePath: string
): Promise<WorktreeRemoveResult> {
  try {
    // Parse task number from directory name (e.g., "T-3" -> 3)
    const dirName = path.basename(worktreePath);
    const taskNumber = parseInt(dirName.slice(2), 10);

    // Get the task to find the branch name
    const task = await getTaskByNumber(projectPath, taskNumber);
    const branchName = task?.branch;

    // Remove the worktree
    execSync(`git worktree remove "${worktreePath}" --force`, {
      cwd: projectPath,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Delete the branch
    if (branchName) {
      try {
        execSync(`git branch -D "${branchName}"`, {
          cwd: projectPath,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch {
        // Branch may already be deleted, ignore
      }
    }

    // Delete task metadata
    if (!isNaN(taskNumber)) {
      await deleteTaskByNumber(projectPath, taskNumber);
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
