/**
 * Task-level GitHub actions, shared by the kanban card menu, the terminal
 * header menu, and the command palette.
 *
 * These wrap the IPC calls with the toasts and store refreshes each one needs.
 *
 * The two detections run unprompted, so a failure is logged rather than
 * toasted — an offline machine would otherwise toast once per task.
 */

import log from 'electron-log/renderer';
import type { TaskWithWorkspace } from '../types';
import { describeError } from '../utils/describeError';
import { useProjectStore } from '../stores/projectStore';
import { useGithubStore } from '../stores/githubStore';

const actionLog = log.scope('github:task');

/** Open a pull request in the project panel, switching to it if needed. */
export function openPullRequestInPanel(projectPath: string, prNumber: number): void {
  useProjectStore.getState().setActivePanel('pull-requests');
  useProjectStore.getState().setKanbanVisible(false);
  const store = useGithubStore.getState();
  store.setProject(projectPath);
  void store.openPullRequest(projectPath, prNumber);
}

/**
 * Push the task's branch and open a pull request for it.
 *
 * The push is the part that can fail for reasons worth reading (no write
 * access, the remote moved on), so its message is surfaced verbatim rather
 * than collapsed into "failed".
 */
export async function createPullRequestForTask(projectPath: string, task: TaskWithWorkspace): Promise<void> {
  const toast = useProjectStore.getState().addToast;
  if (!task.branch) {
    toast('This task has no branch to open a pull request from', 'error');
    return;
  }

  toast(`Pushing ${task.branch}…`);
  const result = await window.api.github.createPr(projectPath, task.taskNumber, {});
  if (!result.success) {
    toast(result.error ?? 'Could not create the pull request', 'error');
    return;
  }

  await useProjectStore.getState().loadTasks(projectPath);
  toast(result.prNumber != null ? `Opened pull request #${result.prNumber}` : 'Opened pull request', {
    type: 'success',
    actionLabel: 'View',
    onAction: () => {
      if (result.prNumber != null) openPullRequestInPanel(projectPath, result.prNumber);
      else if (result.url) void window.api.openExternal(result.url);
    },
  });
}

export async function detectPullRequestForTask(projectPath: string, taskNumber: number): Promise<void> {
  try {
    const result = await window.api.github.detectTaskPr(projectPath, taskNumber);
    if (result.prNumber == null) return;
    await useProjectStore.getState().loadTasksIfActive(projectPath);
  } catch (error) {
    actionLog.warn('pull request detection failed', { taskNumber, error: describeError(error) });
  }
}

export async function detectPullRequestsForProject(projectPath: string): Promise<void> {
  try {
    const { linked } = await window.api.github.detectProjectPrs(projectPath);
    if (linked > 0) await useProjectStore.getState().loadTasksIfActive(projectPath);
  } catch (error) {
    actionLog.warn('project pull request detection failed', { projectPath, error: describeError(error) });
  }
}
