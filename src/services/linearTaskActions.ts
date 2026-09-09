/**
 * Task-level Linear actions, shared by the kanban card menu, the terminal
 * header menu, and the command palette.
 */

import { useProjectStore } from '../stores/projectStore';
import { usePanelStore } from '../stores/panelStore';
import { useLinearStore } from '../stores/linearStore';

/** Open a Linear issue in the project panel, switching to it if needed. */
export function openLinearIssueInPanel(projectPath: string, issueId: string): void {
  useProjectStore.getState().setActivePanel('pull-requests');
  useProjectStore.getState().setKanbanVisible(false);
  usePanelStore.getState().setProject(projectPath);
  const store = useLinearStore.getState();
  store.setProject(projectPath);
  void store.openIssue(projectPath, issueId);
}

/** Detach the issue from a task, from the task's own menu. */
export async function unlinkLinearIssue(projectPath: string, taskNumber: number): Promise<void> {
  const result = await window.api.linear.linkTask(projectPath, taskNumber, null);
  if (!result.success) {
    useProjectStore.getState().addToast(result.error ?? 'Could not unlink the issue', 'error');
    return;
  }
  await useProjectStore.getState().loadTasks(projectPath);
}
