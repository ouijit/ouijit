/**
 * Git worktree management functions
 * Creates isolated worktrees for CLI agents to work without affecting the main branch
 */

import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import koffi from 'koffi';
import { getLogger } from './logger';
import {
  getNextTaskNumber,
  createTask,
  getTask,
  getTaskByNumber,
  deleteTaskByNumber,
  setTaskBranch,
  setTaskWorktreePath,
  setTaskMergeTarget,
  type TaskMetadata,
} from './db';
import { mergeWorktreeBranch } from './git';
import { stopSandboxView } from './lima/sandboxSync';

const worktreeLog = getLogger().scope('worktree');

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

interface Timer {
  mark: (name: string) => void;
  finish: () => Record<string, number>;
}

function timer(): Timer {
  const start = performance.now();
  let last = start;
  const marks: Record<string, number> = {};
  return {
    mark(name) {
      const now = performance.now();
      marks[name] = Math.round(now - last);
      last = now;
    },
    finish() {
      return { ...marks, total: Math.round(performance.now() - start) };
    },
  };
}

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
} catch {
  /* koffi/FFI unavailable, fall through to cp */
}

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
  /** Non-fatal advisories surfaced to the renderer (e.g., missing CLI tool) */
  warnings?: string[];
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
    { cwd: sourcePath, maxBuffer: 10 * 1024 * 1024 }, // 10MB buffer for large lists
  );
  return stdout.split('\n').filter((item) => item.trim());
}

/** Concurrency cap for ignored-file copies. Unbounded `Promise.all` over many
 * top-level dirs spikes CPU and spawns too many cp children at once. */
const COPY_CONCURRENCY = 8;

async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const runners: Promise<void>[] = [];
  const runOne = async (): Promise<void> => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      await worker(items[i]);
    }
  };
  for (let i = 0; i < Math.min(limit, items.length); i++) runners.push(runOne());
  await Promise.all(runners);
}

async function copyGitIgnoredFiles(
  sourcePath: string,
  worktreePath: string,
  prefetchedItems?: string[],
): Promise<void> {
  const t = performance.now();
  let copiedFiles = 0;
  let copiedDirs = 0;
  let cloneSyscalls = 0;
  let cpFallbacks = 0;
  let skipped = 0;
  try {
    const items = prefetchedItems ?? (await fetchIgnoredFiles(sourcePath));
    if (items.length === 0) return;

    await runWithConcurrency(items, COPY_CONCURRENCY, async (item) => {
      // Remove trailing slash if present (directories)
      const cleanItem = item.replace(/\/$/, '');
      if (!cleanItem) return;

      const sourceItem = path.join(sourcePath, cleanItem);
      const destItem = path.join(worktreePath, cleanItem);

      // Validate paths don't escape their roots (prevents path traversal attacks)
      if (!isPathWithinBase(sourcePath, sourceItem) || !isPathWithinBase(worktreePath, destItem)) {
        worktreeLog.warn('skipping suspicious path', { path: cleanItem });
        skipped++;
        return;
      }

      try {
        // Use lstat to detect symlinks without following them
        const stat = await fs.lstat(sourceItem);

        // Skip symlinks to prevent following malicious symlinks to sensitive files
        if (stat.isSymbolicLink()) {
          worktreeLog.warn('skipping symlink', { path: cleanItem });
          skipped++;
          return;
        }

        // Ensure parent directory exists
        await fs.mkdir(path.dirname(destItem), { recursive: true });

        // macOS: clonefile() for individual files only — directories fall through
        // to cp -c (child process) to avoid blocking the event loop on large trees
        if (clonefileFn && stat.isFile()) {
          if (clonefileFn(sourceItem, destItem, 0) === 0) {
            cloneSyscalls++;
            copiedFiles++;
            return;
          }
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
            cloneSyscalls++;
            copiedFiles++;
            return;
          }
          // FICLONE failed — remove empty dest before falling through to cp
          await fs.unlink(destItem).catch(() => {});
        }

        // Fallback: cp command
        if (stat.isDirectory()) {
          const cpFlags = os.platform() === 'darwin' ? '-RPpc' : '-RPp --reflink=auto';
          await execAsync(`cp ${cpFlags} ${shellEscape(sourceItem)} ${shellEscape(destItem)}`);
          copiedDirs++;
          cpFallbacks++;
        } else {
          const cpFlags = os.platform() === 'darwin' ? '-Ppc' : '-Pp --reflink=auto';
          await execAsync(`cp ${cpFlags} ${shellEscape(sourceItem)} ${shellEscape(destItem)}`);
          copiedFiles++;
          cpFallbacks++;
        }
      } catch (error) {
        // Log but don't fail - some files might be transient or locked
        worktreeLog.warn('failed to copy item', {
          path: cleanItem,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  } catch (error) {
    // Log but don't fail worktree creation if git ls-files fails
    worktreeLog.warn('failed to copy gitignored files', {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    worktreeLog.info('copyGitIgnoredFiles', {
      ms: Math.round(performance.now() - t),
      items: prefetchedItems?.length ?? 0,
      copiedFiles,
      copiedDirs,
      cloneSyscalls,
      cpFallbacks,
      skipped,
    });
  }
}

/**
 * Sanitize a name to be git-branch-safe
 */
export function sanitizeBranchName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-') // spaces to hyphens
    .replace(/[^a-z0-9-]/g, '') // remove invalid chars
    .replace(/-+/g, '-') // collapse multiple hyphens
    .replace(/^-|-$/g, ''); // trim leading/trailing hyphens
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
export async function validateBranchName(
  projectPath: string,
  branchName: string,
): Promise<{ valid: boolean; error?: string }> {
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

export async function createTodoTask(projectPath: string, name?: string, prompt?: string): Promise<TaskWorktreeResult> {
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
  branchName?: string,
  baseBranch?: string,
  sandboxed: boolean = false,
): Promise<TaskWorktreeResult> {
  const t = timer();
  try {
    const task = await getTaskByNumber(projectPath, taskNumber);
    t.mark('lookup');
    if (!task) return { success: false, error: 'Task not found' };

    // Idempotent: if already started with a worktree, return success
    if (task.worktreePath) {
      return { success: true, task, worktreePath: task.worktreePath };
    }

    worktreeLog.info('starting task', { taskNumber, name: task.name });

    // Kick off everything that does not depend on each other in parallel.
    const projectName = path.basename(projectPath);
    const baseDir = getWorktreeBaseDir(projectName);
    const branch = branchName || generateBranchName(task.name, taskNumber);

    const headPromise = execAsync('git rev-parse HEAD', { cwd: projectPath }).then(
      () => true,
      () => false,
    );
    const branchHeadPromise = execAsync('git rev-parse --abbrev-ref HEAD', { cwd: projectPath })
      .then(({ stdout }) => stdout.trim())
      .catch((): undefined => undefined);
    const mkdirPromise = fs.mkdir(baseDir, { recursive: true });
    const prunePromise = execAsync('git worktree prune', { cwd: projectPath });
    const branchExistsPromise = execFileAsync('git', ['rev-parse', '--verify', branch], { cwd: projectPath }).then(
      () => true,
      () => false,
    );
    const ignoredFilesPromise = sandboxed ? Promise.resolve<string[]>([]) : fetchIgnoredFiles(projectPath);

    // Probe for an available worktree path. Needs the base dir created first.
    await mkdirPromise;
    let worktreePath = path.join(baseDir, `T-${taskNumber}`);
    let dirNum = taskNumber;
    while (
      await fs.access(worktreePath).then(
        () => true,
        () => false,
      )
    ) {
      dirNum++;
      worktreePath = path.join(baseDir, `T-${dirNum}`);
    }
    t.mark('pathProbe');

    const [hasHead, branchHead, , branchExists] = await Promise.all([
      headPromise,
      branchHeadPromise,
      prunePromise,
      branchExistsPromise,
    ]);
    t.mark('parallelPrelude');

    if (!hasHead) {
      await execAsync('git commit --allow-empty -m "Initial commit"', { cwd: projectPath });
    }

    const mergeTarget = baseBranch || branchHead;

    const wtAddArgs = branchExists
      ? ['worktree', 'add', worktreePath, branch]
      : baseBranch
        ? ['worktree', 'add', '-b', branch, worktreePath, baseBranch]
        : ['worktree', 'add', '-b', branch, worktreePath];

    await execFileAsync('git', wtAddArgs, { cwd: projectPath });
    t.mark('worktreeAdd');

    const dbWrites: Promise<unknown>[] = [
      setTaskBranch(projectPath, taskNumber, branch),
      setTaskWorktreePath(projectPath, taskNumber, worktreePath),
    ];
    if (mergeTarget) dbWrites.push(setTaskMergeTarget(projectPath, taskNumber, mergeTarget));
    await Promise.all(dbWrites);
    t.mark('dbWrites');

    if (!sandboxed) {
      const ignoredFiles = await ignoredFilesPromise;
      await copyGitIgnoredFiles(projectPath, worktreePath, ignoredFiles);
    }
    t.mark('copyIgnored');

    const updated = await getTaskByNumber(projectPath, taskNumber);
    t.mark('refetch');
    worktreeLog.info('startTask timings', { taskNumber, ...t.finish() });
    worktreeLog.info('started task', { taskNumber, worktreePath, branch });
    return { success: true, task: updated || undefined, worktreePath };
  } catch (error) {
    worktreeLog.error('startTask failed', {
      taskNumber,
      ...t.finish(),
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, error: error instanceof Error ? error.message : 'Failed to start task' };
  }
}

export async function createTaskWorktree(
  projectPath: string,
  name?: string,
  prompt?: string,
  branchName?: string,
  sandboxed: boolean = false,
): Promise<TaskWorktreeResult> {
  try {
    const [hasHead, branchResult, taskNumber] = await Promise.all([
      // Check if repo has any commits (worktrees require a valid HEAD)
      execAsync('git rev-parse HEAD', { cwd: projectPath }).then(
        () => true,
        () => false,
      ),
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
    while (
      await fs.access(worktreePath).then(
        () => true,
        () => false,
      )
    ) {
      currentTaskNumber++;
      worktreePath = path.join(baseDir, `T-${currentTaskNumber}`);
    }

    const branch = branchName || generateBranchName(name, currentTaskNumber);

    // Prune stale worktree registrations so deleted directories can be reused
    await execFileAsync('git', ['worktree', 'prune'], { cwd: projectPath });

    // Check if branch already exists (e.g. leftover from a previous failed attempt)
    const branchExists = await execFileAsync('git', ['rev-parse', '--verify', branch], { cwd: projectPath }).then(
      () => true,
      () => false,
    );
    const wtAddArgs = branchExists
      ? ['worktree', 'add', worktreePath, branch]
      : ['worktree', 'add', '-b', branch, worktreePath];

    // Start ls-files in parallel with git worktree add
    // ls-files reads from source dir, doesn't need the worktree to exist
    const [, ignoredFiles] = await Promise.all([
      execFileAsync('git', wtAddArgs, { cwd: projectPath }),
      sandboxed ? Promise.resolve<string[]>([]) : fetchIgnoredFiles(projectPath),
    ]);

    const task = await createTask(projectPath, currentTaskNumber, displayName, {
      branch,
      mergeTarget,
      prompt,
      worktreePath,
      sandboxed,
    });

    if (!sandboxed) {
      await copyGitIgnoredFiles(projectPath, worktreePath, ignoredFiles);
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
  worktreePath: string,
  taskNumber: number,
): Promise<WorktreeRemoveResult> {
  try {
    // Get the task to find the branch name
    const task = await getTaskByNumber(projectPath, taskNumber);
    const branchName = task?.branch;

    // Best-effort: remove the sandbox-view worktree and its s/<branch>
    // branch before touching the user worktree, so git's metadata stays
    // consistent. Swallow errors — the view may already be gone.
    if (task?.sandboxed && task.branch && !Number.isNaN(taskNumber)) {
      try {
        await stopSandboxView(projectPath, taskNumber, task.branch);
      } catch (error) {
        worktreeLog.warn('sandbox view cleanup failed', {
          taskNumber,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Remove the worktree
    await execFileAsync('git', ['worktree', 'remove', worktreePath, '--force'], {
      cwd: projectPath,
      encoding: 'utf8',
    });

    // Delete the branch
    if (branchName) {
      try {
        await execFileAsync('git', ['branch', '-D', branchName], {
          cwd: projectPath,
          encoding: 'utf8',
        });
      } catch {
        // Branch may already be deleted, ignore
      }
    }

    // Delete task metadata
    if (!Number.isNaN(taskNumber)) {
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
      const worktreeLine = lines.find((l) => l.startsWith('worktree '));
      const branchLine = lines.find((l) => l.startsWith('branch '));

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

export interface CheckWorktreeResult {
  exists: boolean;
  branchExists: boolean;
}

/**
 * Check if a task's worktree directory and branch still exist
 */
export async function checkTaskWorktree(projectPath: string, taskNumber: number): Promise<CheckWorktreeResult> {
  const task = await getTaskByNumber(projectPath, taskNumber);
  if (!task || !task.worktreePath) {
    worktreeLog.info('check: no task or no worktreePath', { taskNumber });
    return { exists: false, branchExists: false };
  }

  const [exists, branchExists] = await Promise.all([
    fs.access(task.worktreePath).then(
      () => true,
      () => false,
    ),
    task.branch
      ? execAsync(`git rev-parse --verify refs/heads/${shellEscape(task.branch)}`, { cwd: projectPath }).then(
          () => true,
          () => false,
        )
      : Promise.resolve(false),
  ]);

  worktreeLog.info('check', { taskNumber, exists, branchExists, path: task.worktreePath });
  return { exists, branchExists };
}

/**
 * Recover a task whose worktree directory was deleted externally.
 * Prunes stale worktrees, then re-creates from the existing branch.
 */
export async function recoverTaskWorktree(projectPath: string, taskNumber: number): Promise<TaskWorktreeResult> {
  try {
    const task = await getTaskByNumber(projectPath, taskNumber);
    if (!task) return { success: false, error: 'Task not found' };
    if (!task.branch) return { success: false, error: 'Task has no branch' };

    worktreeLog.info('recovering', { taskNumber, branch: task.branch, oldPath: task.worktreePath });

    // Prune stale worktree references so git doesn't complain about the old path
    await execAsync('git worktree prune', { cwd: projectPath });

    // Verify the branch still exists
    try {
      await execAsync(`git rev-parse --verify refs/heads/${shellEscape(task.branch)}`, { cwd: projectPath });
    } catch {
      return { success: false, error: 'Branch not found' };
    }

    // Check if the branch is already checked out in another worktree
    // (use raw git output — listWorktrees filters to managed dirs only)
    const { stdout: wtList } = await execAsync('git worktree list --porcelain', { cwd: projectPath, encoding: 'utf8' });
    let existing: { path: string } | undefined;
    for (const entry of wtList.split('\n\n').filter(Boolean)) {
      const lines = entry.split('\n');
      const wtLine = lines.find((l) => l.startsWith('worktree '));
      const brLine = lines.find((l) => l.startsWith('branch refs/heads/'));
      if (wtLine && brLine && brLine.replace('branch refs/heads/', '') === task.branch) {
        existing = { path: wtLine.replace('worktree ', '') };
        break;
      }
    }
    if (existing) {
      // Branch is already checked out — reuse that worktree path
      worktreeLog.info('branch already checked out, reusing worktree', { taskNumber, worktreePath: existing.path });
      await setTaskWorktreePath(projectPath, taskNumber, existing.path);
      const updated = await getTaskByNumber(projectPath, taskNumber);
      return { success: true, task: updated || undefined, worktreePath: existing.path };
    }

    // Find a new worktree directory path
    const projectName = path.basename(projectPath);
    const baseDir = getWorktreeBaseDir(projectName);
    await fs.mkdir(baseDir, { recursive: true });

    let worktreePath = path.join(baseDir, `T-${taskNumber}`);
    let dirNum = taskNumber;
    while (
      await fs.access(worktreePath).then(
        () => true,
        () => false,
      )
    ) {
      dirNum++;
      worktreePath = path.join(baseDir, `T-${dirNum}`);
    }

    // Re-create worktree from the existing branch (no -b flag)
    const [, ignoredFiles] = await Promise.all([
      execAsync(`git worktree add ${shellEscape(worktreePath)} ${shellEscape(task.branch)}`, { cwd: projectPath }),
      task.sandboxed ? Promise.resolve<string[]>([]) : fetchIgnoredFiles(projectPath),
    ]);

    // Update metadata with new path
    await setTaskWorktreePath(projectPath, taskNumber, worktreePath);

    if (!task.sandboxed) {
      await copyGitIgnoredFiles(projectPath, worktreePath, ignoredFiles);
    }

    worktreeLog.info('recovered', { taskNumber, worktreePath });
    const updated = await getTaskByNumber(projectPath, taskNumber);
    return { success: true, task: updated || undefined, worktreePath };
  } catch (error) {
    worktreeLog.error('recover failed', { taskNumber, error: error instanceof Error ? error.message : String(error) });
    return { success: false, error: error instanceof Error ? error.message : 'Failed to recover worktree' };
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
  const worktree = worktrees.find((wt) => wt.branch === worktreeBranch);

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
