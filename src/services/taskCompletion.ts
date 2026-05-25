/**
 * Shared "task is being marked done" flow. Both the kanban drag-to-done and
 * the terminal Close Task context menu route through here so a single
 * confirmation dialog drives whether the task's open terminals get closed.
 *
 * Callers remain responsible for the actual status change, view-level cleanup
 * (e.g. closing the originating terminal card), and toasts. This helper owns
 * just the prompt + closure of related terminals.
 */

import { closeProjectTerminal } from '../components/terminal/terminalActions';
import { findOtherTaskTerminals } from '../components/terminal/findOtherTaskTerminals';
import { useProjectStore } from '../stores/projectStore';
import { useTerminalStore } from '../stores/terminalStore';

export interface RequestCloseTaskOptions {
  projectPath: string;
  taskNumber: number;
  taskName: string;
  /**
   * When the request originates from a specific terminal's Close Task menu,
   * pass that terminal's ptyId. It is excluded from the count (the caller
   * closes it separately via its own `onClose`) and the dialog adjusts copy.
   */
  contextPtyId?: string;
}

export interface CloseTaskResult {
  /** True if the user cancelled — no status change should happen. */
  cancelled: boolean;
  /** True if related task terminals were closed as part of this flow. */
  closedAll: boolean;
}

export async function requestCloseTask(opts: RequestCloseTaskOptions): Promise<CloseTaskResult> {
  const { projectPath, taskNumber, taskName, contextPtyId } = opts;
  const store = useTerminalStore.getState();
  const relatedPtyIds = findOtherTaskTerminals(
    store.terminalsByProject,
    store.displayStates,
    projectPath,
    taskNumber,
    contextPtyId ?? '',
  );

  if (relatedPtyIds.length === 0) {
    return { cancelled: false, closedAll: false };
  }

  const action = await useProjectStore.getState().requestCloseTask({
    projectPath,
    taskNumber,
    taskName,
    terminalCount: relatedPtyIds.length,
    includesCurrent: contextPtyId != null,
  });

  if (action == null) return { cancelled: true, closedAll: false };

  if (action === 'close-all') {
    for (const id of relatedPtyIds) closeProjectTerminal(id);
  }

  return { cancelled: false, closedAll: action === 'close-all' };
}
