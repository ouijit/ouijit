/**
 * Git worktree management functions
 * Creates isolated worktrees for CLI agents to work without affecting the main branch
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import koffi from 'koffi';
import { getNextTaskNumber, createTask, getTask, getTaskByNumber, deleteTaskByNumber, setTaskBranch, setTaskWorktreePath, setTaskMergeTarget, type TaskMetadata, type TaskStatus } from './db';
import { mergeWorktreeBranch } from './git';

const execAsync = promisify(exec);

// Native CoW clone support via koffi FFI
// macOS: clonefile() clones files and directories atomically in one kernel call
// Linux: ioctl(FICLONE) for CoW file cloning on btrfs/xfs
let clonefileFn: ((src: string, dst: string, flags: number) => number) | null = null;
let ficloneFn: ((destFd: number, srcFd: number) => boolean) | null = null;

try {
  if (os.platform() === 'darwin') {
    const lib = koffi.load('libSystem.B.dylib');
    clonefileFn = lib.func('clonefile', 'int', ['str', 'str', 'int']);
  } else if (os.platform() === 'linux') {
    const lib = koffi.load('libc.so.6');
    // ioctl is variadic — koffi requires '...' marker for correct ARM64 calling convention
    const ioctl = lib.func('ioctl', 'int', ['int', 'unsigned long', '...']);
    const FICLONE = 0x40049409; // _IOW(0x94, 9, int)
    ficloneFn = (destFd: number, srcFd: number) => ioctl(destFd, FICLONE, 'int', srcFd) === 0;
  }
} catch { /* koffi/FFI unavailable, fall through to cp */ }

export interface WorktreeInfo {
  path: string;
  branch: string;
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
 * Check if a resolved path is within the expected base directory
 * Prevents path traversal attacks via ../ sequences
 */
function isPathWithinBase(basePath: string, targetPath: string): boolean {
  const resolvedBase = path.resolve(basePath);
  const resolvedTarget = path.resolve(targetPath);
  return resolvedTarget.startsWith(resolvedBase + path.sep) || resolvedTarget === resolvedBase;
}

/**
 * Copy all gitignored files from source project to worktree
 * This ensures secrets, local configs, dependencies, and other untracked files are available
 * Uses APFS clones for instant, space-efficient copies
 */
/**
 * Fetch the list of gitignored files from the source project.
 * Can be started before the worktree exists since it only reads the source directory.
 */
async function fetchIgnoredFiles(sourcePath: string): Promise<string[]> {
  // --others: untracked files
  // --ignored: only show ignored files
  // --exclude-standard: use .gitignore, .git/info/exclude, global gitignore
  // --directory: show directory names instead of their contents (efficient for copying whole dirs)
  const { stdout } = await execAsync(
    'git ls-files --others --ignored --exclude-standard --directory',
    { cwd: sourcePath, maxBuffer: 10 * 1024 * 1024 } // 10MB buffer for large lists
  );
  return stdout.split('\n').filter(item => item.trim());
}

async function copyGitIgnoredFiles(sourcePath: string, worktreePath: string, prefetchedItems?: string[]): Promise<void> {
  try {
    const items = prefetchedItems ?? await fetchIgnoredFiles(sourcePath);
    if (items.length === 0) return;

    // Copy each item in parallel
    const copyPromises = items.map(async (item) => {
      // Remove trailing slash if present (directories)
      const cleanItem = item.replace(/\/$/, '');
      if (!cleanItem) return;

      const sourceItem = path.join(sourcePath, cleanItem);
      const destItem = path.join(worktreePath, cleanItem);

      // Validate paths don't escape their roots (prevents path traversal attacks)
      if (!isPathWithinBase(sourcePath, sourceItem) || !isPathWithinBase(worktreePath, destItem)) {
        console.warn(`[worktree] Skipping suspicious path: ${cleanItem}`);
        return;
      }

      try {
        // Use lstat to detect symlinks without following them
        const stat = await fs.lstat(sourceItem);

        // Skip symlinks to prevent following malicious symlinks to sensitive files
        if (stat.isSymbolicLink()) {
          console.warn(`[worktree] Skipping symlink: ${cleanItem}`);
          return;
        }

        // Ensure parent directory exists
        await fs.mkdir(path.dirname(destItem), { recursive: true });

        // macOS: clonefile() handles both files and directories in one kernel call
        if (clonefileFn) {
          if (clonefileFn(sourceItem, destItem, 0) === 0) return;
          // Fall through to cp on failure (e.g. EEXIST from race with start script, non-APFS, cross-volume)
        }

        // Linux: ioctl(FICLONE) for per-file CoW cloning on btrfs/xfs
        if (ficloneFn && stat.isFile()) {
          let cloned = false;
          const srcHandle = await fs.open(sourceItem, 'r');
          try {
            const dstHandle = await fs.open(destItem, 'w', stat.mode);
            try {
              cloned = ficloneFn(dstHandle.fd, srcHandle.fd);
            } finally {
              await dstHandle.close();
            }
          } finally {
            await srcHandle.close();
          }
          if (cloned) {
            await fs.utimes(destItem, stat.atime, stat.mtime);
            return;
          }
          // FICLONE failed — remove empty dest before falling through to cp
          await fs.unlink(destItem).catch(() => {});
        }

        // Fallback: cp command
        if (stat.isDirectory()) {
          const cpFlags = os.platform() === 'darwin' ? '-RPpc' : '-RPp --reflink=auto';
          await execAsync(`cp ${cpFlags} ${shellEscape(sourceItem)} ${shellEscape(destItem)}`);
        } else {
          const cpFlags = os.platform() === 'darwin' ? '-Ppc' : '-Pp --reflink=auto';
          await execAsync(`cp ${cpFlags} ${shellEscape(sourceItem)} ${shellEscape(destItem)}`);
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
export function sanitizeBranchName(name: string): string {
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
export function generateBranchName(name: string | undefined, taskNumber: number): string {
  if (name) {
    const sanitized = sanitizeBranchName(name);
    if (sanitized) {
      return `${sanitized}-${taskNumber}`;
    }
  }
  return `task-${taskNumber}`;
}

/**
 * Validate a branch name for git compatibility and conflicts
 */
export async function validateBranchName(projectPath: string, branchName: string): Promise<{ valid: boolean; error?: string }> {
  if (!branchName) {
    return { valid: false, error: 'Branch name is required' };
  }

  if (branchName.length > 100) {
    return { valid: false, error: 'Branch name must be 100 characters or less' };
  }

  if (branchName === 'HEAD') {
    return { valid: false, error: 'HEAD is a reserved name' };
  }

  // Check git ref format validity
  try {
    await execAsync(`git check-ref-format --branch ${shellEscape(branchName)}`, { cwd: projectPath });
  } catch {
    return { valid: false, error: 'Invalid branch name' };
  }

  // Check for conflicts with existing branches
  try {
    const { stdout } = await execAsync(`git branch --list ${shellEscape(branchName)}`, { cwd: projectPath });
    if (stdout.trim()) {
      return { valid: false, error: 'Branch already exists' };
    }
  } catch {
    // If git branch --list fails, skip conflict check
  }

  return { valid: true };
}


export async function createTodoTask(
  projectPath: string,
  name?: string,
  prompt?: string
): Promise<TaskWorktreeResult> {
  try {
    const taskNumber = await getNextTaskNumber(projectPath);
    const displayName = name || 'Untitled';
    const task = await createTask(projectPath, taskNumber, displayName, { status: 'todo', prompt });
    return { success: true, task };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create task' };
  }
}

export async function startTask(
  projectPath: string,
  taskNumber: number,
  branchName?: string
): Promise<TaskWorktreeResult> {
  try {
    const task = await getTaskByNumber(projectPath, taskNumber);
    if (!task) return { success: false, error: 'Task not found' };
    if (task.status !== 'todo') return { success: false, error: 'Task is already started' };

    const [hasHead, branchResult] = await Promise.all([
      execAsync('git rev-parse HEAD', { cwd: projectPath }).then(() => true, () => false),
      execAsync('git rev-parse --abbrev-ref HEAD', { cwd: projectPath })
        .then(({ stdout }) => stdout.trim())
        .catch((): undefined => undefined),
    ]);

    if (!hasHead) {
      await execAsync('git commit --allow-empty -m "Initial commit"', { cwd: projectPath });
    }

    const mergeTarget = branchResult;
    const projectName = path.basename(projectPath);
    const baseDir = getWorktreeBaseDir(projectName);
    await fs.mkdir(baseDir, { recursive: true });

    let worktreePath = path.join(baseDir, `T-${taskNumber}`);
    let dirNum = taskNumber;
    while (await fs.access(worktreePath).then(() => true, () => false)) {
      dirNum++;
      worktreePath = path.join(baseDir, `T-${dirNum}`);
    }

    const branch = branchName || generateBranchName(task.name, taskNumber);

    const [, ignoredFiles] = await Promise.all([
      execAsync(`git worktree add -b "${branch}" "${worktreePath}"`, { cwd: projectPath }),
      fetchIgnoredFiles(projectPath),
    ]);

    await Promise.all([
      setTaskBranch(projectPath, taskNumber, branch),
      setTaskWorktreePath(projectPath, taskNumber, worktreePath),
    ]);

    if (mergeTarget) {
      await setTaskMergeTarget(projectPath, taskNumber, mergeTarget);
    }

    copyGitIgnoredFiles(projectPath, worktreePath, ignoredFiles).catch(err => {
      console.warn('[worktree] Background copy failed:', err);
    });

    const updated = await getTaskByNumber(projectPath, taskNumber);
    return { success: true, task: updated || undefined, worktreePath };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to start task' };
  }
}

export async function createTaskWorktree(projectPath: string, name?: string, prompt?: string, branchName?: string): Promise<TaskWorktreeResult> {
  try {
    const [hasHead, branchResult, taskNumber] = await Promise.all([
      // Check if repo has any commits (worktrees require a valid HEAD)
      execAsync('git rev-parse HEAD', { cwd: projectPath }).then(() => true, () => false),
      // Capture source branch as the default merge target
      execAsync('git rev-parse --abbrev-ref HEAD', { cwd: projectPath })
        .then(({ stdout }) => stdout.trim())
        .catch((): undefined => undefined),
      // Get next task number
      getNextTaskNumber(projectPath),
    ]);

    if (!hasHead) {
      await execAsync('git commit --allow-empty -m "Initial commit"', { cwd: projectPath });
    }

    const mergeTarget = branchResult;
    const projectName = path.basename(projectPath);
    const displayName = name || 'Untitled';

    // Find available worktree path (skip stale directories)
    const baseDir = getWorktreeBaseDir(projectName);
    await fs.mkdir(baseDir, { recursive: true });

    let currentTaskNumber = taskNumber;
    let worktreePath = path.join(baseDir, `T-${currentTaskNumber}`);
    while (await fs.access(worktreePath).then(() => true, () => false)) {
      currentTaskNumber++;
      worktreePath = path.join(baseDir, `T-${currentTaskNumber}`);
    }

    const branch = branchName || generateBranchName(name, currentTaskNumber);

    // Start ls-files in parallel with git worktree add
    // ls-files reads from source dir, doesn't need the worktree to exist
    const [, ignoredFiles] = await Promise.all([
      execAsync(`git worktree add -b "${branch}" "${worktreePath}"`, { cwd: projectPath }),
      fetchIgnoredFiles(projectPath),
    ]);

    const task = await createTask(projectPath, currentTaskNumber, displayName, { branch, mergeTarget, prompt, worktreePath });

    // Fire-and-forget file copy with pre-fetched list
    copyGitIgnoredFiles(projectPath, worktreePath, ignoredFiles).catch(err => {
      console.warn('[worktree] Background copy failed:', err);
    });

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
  worktreePath: string,
  taskNumber: number
): Promise<WorktreeRemoveResult> {
  try {
    // Get the task to find the branch name
    const task = await getTaskByNumber(projectPath, taskNumber);
    const branchName = task?.branch;

    // Remove the worktree
    await execAsync(`git worktree remove "${worktreePath}" --force`, {
      cwd: projectPath,
      encoding: 'utf8',
    });

    // Delete the branch
    if (branchName) {
      try {
        await execAsync(`git branch -D "${branchName}"`, {
          cwd: projectPath,
          encoding: 'utf8',
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
export async function listWorktrees(projectPath: string): Promise<WorktreeInfo[]> {
  try {
    const projectName = path.basename(projectPath);
    const baseDir = getWorktreeBaseDir(projectName);

    const { stdout: output } = await execAsync('git worktree list --porcelain', {
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

/**
 * Ship a worktree branch: check for uncommitted changes, then merge into the target branch.
 */
export async function shipWorktree(
  projectPath: string,
  worktreeBranch: string,
  commitMessage?: string,
): Promise<{ success: boolean; error?: string; conflictFiles?: string[]; mergedBranch?: string }> {
  // Check for uncommitted changes in the worktree
  const worktrees = await listWorktrees(projectPath);
  const worktree = worktrees.find(wt => wt.branch === worktreeBranch);

  if (worktree) {
    try {
      const { stdout: status } = await execAsync('git status --porcelain', {
        cwd: worktree.path,
        encoding: 'utf8',
      });
      if (status.trim().length > 0) {
        return {
          success: false,
          error: 'Uncommitted changes in worktree. Commit or stash first.',
        };
      }
    } catch {
      // Ignore check errors and proceed
    }
  }

  // Get the merge target from task metadata
  const task = await getTask(projectPath, worktreeBranch);
  const targetBranch = task?.mergeTarget;

  // Attempt to merge
  const result = mergeWorktreeBranch(projectPath, worktreeBranch, commitMessage, targetBranch);

  if (!result.success && result.error?.includes('conflict')) {
    return {
      success: false,
      error: result.error,
      conflictFiles: [],
    };
  }

  return result;
}
