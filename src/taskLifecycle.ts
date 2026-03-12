/**
 * Task lifecycle operations that orchestrate across task metadata, worktrees, and hooks.
 * Extracted from IPC handlers to keep handlers as thin one-liner delegations.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { shell } from 'electron';
import {
  getProjectTasks,
  getTaskByNumber,
  setTaskStatus,
  deleteTaskByNumber,
  reorderTask,
  type TaskStatus,
} from './db';
import { listWorktrees, removeTaskWorktree } from './worktree';
import type { TaskWithWorkspace } from './types';
import log from './log';

const execAsync = promisify(exec);

const taskLog = log.scope('task');

/**
 * Set task status. Hooks are handled by the renderer (shown in a terminal).
 */
export async function setTaskStatusWithHooks(
  projectPath: string,
  taskNumber: number,
  status: TaskStatus,
): Promise<{ success: boolean; error?: string }> {
  const result = await setTaskStatus(projectPath, taskNumber, status);
  if (!result.success) {
    taskLog.error('setStatus failed', { taskNumber, status, error: result.error });
  }
  return result;
}

/**
 * Reorder task (status + position). Hooks are handled by the renderer (shown in a terminal).
 */
export async function reorderTaskWithHooks(
  projectPath: string,
  taskNumber: number,
  newStatus: TaskStatus,
  targetIndex: number,
): Promise<{ success: boolean; error?: string }> {
  const result = await reorderTask(projectPath, taskNumber, newStatus, targetIndex);
  if (!result.success) {
    taskLog.error('reorder failed', { taskNumber, status: newStatus, error: result.error });
  }
  return result;
}

/**
 * Delete a task, removing its worktree if one exists.
 */
export async function deleteTaskWithWorktree(
  projectPath: string,
  taskNumber: number,
): Promise<{ success: boolean; error?: string }> {
  const task = await getTaskByNumber(projectPath, taskNumber);
  if (task?.worktreePath || task?.branch) {
    const worktrees = await listWorktrees(projectPath);
    const wt = task.branch
      ? worktrees.find((w) => w.branch === task.branch)
      : worktrees.find((w) => w.path === task.worktreePath);
    if (wt) {
      taskLog.info('deleting task with worktree', { taskNumber, worktreePath: wt.path });
      const removeResult = await removeTaskWorktree(projectPath, wt.path, taskNumber);
      if (!removeResult.success) {
        taskLog.error('worktree removal failed', { taskNumber, error: removeResult.error });
        return removeResult;
      }
      return { success: true };
    }
    taskLog.info('deleting task (metadata-only)', { taskNumber });
  }
  return deleteTaskByNumber(projectPath, taskNumber);
}

/**
 * Delete a task, moving its worktree directory to the OS trash (recoverable)
 * instead of permanently deleting it with `git worktree remove --force`.
 */
export async function trashTaskWithWorktree(
  projectPath: string,
  taskNumber: number,
): Promise<{ success: boolean; error?: string; trashed?: boolean }> {
  const task = await getTaskByNumber(projectPath, taskNumber);

  // Resolve the worktree path — prefer the DB path, fall back to git worktree list
  let worktreePath: string | undefined;
  if (task?.worktreePath && existsSync(task.worktreePath)) {
    worktreePath = task.worktreePath;
  } else if (task?.branch) {
    const worktrees = await listWorktrees(projectPath);
    const wt = worktrees.find((w) => w.branch === task.branch);
    if (wt) worktreePath = wt.path;
  }

  if (worktreePath) {
    taskLog.info('trashing task worktree', { taskNumber, worktreePath });
    try {
      await shell.trashItem(worktreePath);
      await execAsync('git worktree prune', { cwd: projectPath, encoding: 'utf8' });
    } catch (trashError) {
      const msg = trashError instanceof Error ? trashError.message : String(trashError);
      taskLog.error('trashItem failed', { taskNumber, error: msg });
      return { success: false, error: `Failed to move worktree to trash: ${msg}` };
    }

    // Delete the branch
    if (task?.branch) {
      try {
        await execAsync(`git branch -D "${task.branch}"`, { cwd: projectPath, encoding: 'utf8' });
      } catch {
        // Branch may already be deleted
      }
    }

    const dbResult = await deleteTaskByNumber(projectPath, taskNumber);
    return { ...dbResult, trashed: true };
  }

  taskLog.info('trashing task (metadata-only)', { taskNumber });
  return deleteTaskByNumber(projectPath, taskNumber);
}

/**
 * Get all tasks with their resolved worktree paths.
 */
export async function getTasksWithWorkspaces(projectPath: string): Promise<TaskWithWorkspace[]> {
  const worktrees = await listWorktrees(projectPath);
  const tasks = await getProjectTasks(projectPath);
  const worktreeMap = new Map(worktrees.map((wt) => [wt.branch, wt]));

  return tasks.map((task) => {
    const wt = task.branch ? worktreeMap.get(task.branch) : undefined;
    return {
      taskNumber: task.taskNumber,
      name: task.name,
      status: task.status,
      branch: task.branch,
      worktreePath: wt?.path || task.worktreePath,
      createdAt: task.createdAt,
      closedAt: task.closedAt,
      mergeTarget: task.mergeTarget,
      prompt: task.prompt,
      sandboxed: task.sandboxed,
      order: task.order,
    };
  });
}

/**
 * Get a single task with its resolved worktree path.
 */
export async function getTaskWithWorkspace(projectPath: string, taskNumber: number): Promise<TaskWithWorkspace | null> {
  const task = await getTaskByNumber(projectPath, taskNumber);
  if (!task) return null;
  const worktrees = await listWorktrees(projectPath);
  const wt = task.branch ? worktrees.find((w) => w.branch === task.branch) : undefined;
  return {
    taskNumber: task.taskNumber,
    name: task.name,
    status: task.status,
    branch: task.branch,
    worktreePath: wt?.path || task.worktreePath,
    createdAt: task.createdAt,
    closedAt: task.closedAt,
    mergeTarget: task.mergeTarget,
    prompt: task.prompt,
    sandboxed: task.sandboxed,
    order: task.order,
  };
}
