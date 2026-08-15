/**
 * Task-level GitHub actions, shared by the kanban card menu, the terminal
 * header menu, and the command palette.
 *
 * These wrap the IPC calls with the toasts and store refreshes each one needs,
 * so the three entry points can't drift into behaving differently for the same
 * action.
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

export async function unlinkPullRequest(projectPath: string, taskNumber: number): Promise<void> {
  const result = await window.api.github.linkTaskPr(projectPath, taskNumber, null);
  if (!result.success) {
    useProjectStore.getState().addToast(result.error ?? 'Could not unlink the pull request', 'error');
    return;
  }
  await useProjectStore.getState().loadTasks(projectPath);
}

/**
 * Look for an existing PR on a task's branch and link it.
 *
 * Runs when a task's terminal opens, so a PR created from the terminal (or by
 * someone else pushing to the same branch) shows on the card without the user
 * telling the app about it. Failures are silent by design: this is a background
 * nicety, and a toast for every offline task would be noise.
 */
export async function detectPullRequestForTask(projectPath: string, taskNumber: number): Promise<void> {
  try {
    const result = await window.api.github.detectTaskPr(projectPath, taskNumber);
    if (result.prNumber == null) return;
    await useProjectStore.getState().loadTasks(projectPath);
  } catch (error) {
    actionLog.warn('pull request detection failed', { taskNumber, error: describeError(error) });
  }
}
