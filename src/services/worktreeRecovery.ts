/**
 * Recovering a task's worktree when it has gone missing from disk — deleted by
 * hand, or pruned by git behind the app's back.
 *
 * The prompt is raised through the ui store rather than rendered by the caller,
 * so every surface that opens a task gets it. `GlobalMissingWorktreeDialog` in
 * App.tsx is what renders it; without that mounted, `ensureWorktree` never
 * settles.
 */

import log from 'electron-log/renderer';
import type { TaskWithWorkspace } from '../types';
import { useProjectStore } from '../stores/projectStore';
import { useUIStore } from '../stores/uiStore';

const recoveryLog = log.scope('worktree');

export interface EnsuredWorktree {
  path: string;
  branch: string;
}

/**
 * Resolves the worktree to spawn into, prompting to recreate it when it is
 * gone. Null means the user cancelled or the recovery failed — the caller has
 * nothing to open and should not report an error of its own.
 */
export async function ensureWorktree(projectPath: string, task: TaskWithWorkspace): Promise<EnsuredWorktree | null> {
  const check = await window.api.task.checkWorktree(projectPath, task.taskNumber).catch((err: unknown): null => {
    recoveryLog.error('worktree check failed', { taskNumber: task.taskNumber, error: String(err) });
    useProjectStore.getState().addToast('Failed to check worktree', 'error');
    return null;
  });
  if (!check) return null;
  if (check.status === 'present') return { path: check.worktreePath, branch: task.branch ?? '' };

  recoveryLog.warn('worktree missing', { taskNumber: task.taskNumber, branchExists: check.branchExists });

  const action = await useUIStore.getState().requestMissingWorktree({ task, branchExists: check.branchExists });

  if (action !== 'recover') {
    recoveryLog.info('user cancelled worktree recovery', { taskNumber: task.taskNumber });
    return null;
  }

  const result = await window.api.task.recover(projectPath, task.taskNumber);
  if (!result.success || !result.worktreePath) {
    recoveryLog.error('worktree recovery failed', { taskNumber: task.taskNumber, error: result.error });
    useProjectStore.getState().addToast(result.error || 'Failed to recover worktree', 'error');
    return null;
  }

  recoveryLog.info('worktree recovered', { taskNumber: task.taskNumber, worktreePath: result.worktreePath });
  void useProjectStore.getState().loadTasksIfActive(projectPath);
  return { path: result.worktreePath, branch: result.task?.branch || task.branch || '' };
}
