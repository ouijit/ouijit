/**
 * Task lifecycle operations that orchestrate across task metadata, worktrees, and hooks.
 * Extracted from IPC handlers to keep handlers as thin one-liner delegations.
 */

import {
  getProjectTasks,
  getTaskByNumber,
  setTaskStatus,
  deleteTaskByNumber,
  reorderTask,
  getHook,
  type TaskStatus,
} from './db';
import { listWorktrees, removeTaskWorktree } from './worktree';
import { executeHook } from './hookRunner';
import type { TaskWithWorkspace } from './types';

/**
 * Run the cleanup hook if transitioning to 'done' from a non-done state.
 * Returns a warning message if the hook fails, undefined otherwise.
 */
async function runCleanupHookIfNeeded(
  projectPath: string,
  taskNumber: number,
  targetStatus: TaskStatus,
): Promise<string | undefined> {
  if (targetStatus !== 'done') return undefined;

  const task = await getTaskByNumber(projectPath, taskNumber);
  if (!task || task.status === 'done') return undefined;

  const cleanupHook = await getHook(projectPath, 'cleanup');
  if (!cleanupHook) return undefined;

  const worktrees = await listWorktrees(projectPath);
  const worktree = task.branch ? worktrees.find(wt => wt.branch === task.branch) : undefined;
  if (!worktree) return undefined;

  const hookResult = await executeHook(cleanupHook, worktree.path, {
    projectPath,
    worktreePath: worktree.path,
    taskBranch: task.branch || '',
    taskName: task.name,
    taskPrompt: task.prompt,
  });

  if (!hookResult.success) {
    const warningMessage = hookResult.error || hookResult.output;
    return warningMessage && warningMessage.length > 500
      ? warningMessage.slice(0, 500) + '...'
      : warningMessage;
  }

  return undefined;
}

/**
 * Set task status with cleanup hook execution on transition to 'done'.
 */
export async function setTaskStatusWithHooks(
  projectPath: string,
  taskNumber: number,
  status: TaskStatus,
): Promise<{ success: boolean; error?: string; hookWarning?: string }> {
  const hookWarning = await runCleanupHookIfNeeded(projectPath, taskNumber, status);
  const result = await setTaskStatus(projectPath, taskNumber, status);
  return { ...result, hookWarning };
}

/**
 * Reorder task with cleanup hook execution when reordering into 'done'.
 */
export async function reorderTaskWithHooks(
  projectPath: string,
  taskNumber: number,
  newStatus: TaskStatus,
  targetIndex: number,
): Promise<{ success: boolean; error?: string; hookWarning?: string }> {
  const hookWarning = await runCleanupHookIfNeeded(projectPath, taskNumber, newStatus);
  const result = await reorderTask(projectPath, taskNumber, newStatus, targetIndex);
  return { ...result, hookWarning };
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
      ? worktrees.find(w => w.branch === task.branch)
      : worktrees.find(w => w.path === task.worktreePath);
    if (wt) {
      const removeResult = await removeTaskWorktree(projectPath, wt.path, taskNumber);
      if (!removeResult.success) return removeResult;
      return { success: true };
    }
  }
  return deleteTaskByNumber(projectPath, taskNumber);
}

/**
 * Get all tasks with their resolved worktree paths.
 */
export async function getTasksWithWorkspaces(projectPath: string): Promise<TaskWithWorkspace[]> {
  const worktrees = await listWorktrees(projectPath);
  const tasks = await getProjectTasks(projectPath);
  const worktreeMap = new Map(worktrees.map(wt => [wt.branch, wt]));

  return tasks.map(task => {
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
export async function getTaskWithWorkspace(
  projectPath: string,
  taskNumber: number,
): Promise<TaskWithWorkspace | null> {
  const task = await getTaskByNumber(projectPath, taskNumber);
  if (!task) return null;
  const worktrees = await listWorktrees(projectPath);
  const wt = task.branch ? worktrees.find(w => w.branch === task.branch) : undefined;
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
