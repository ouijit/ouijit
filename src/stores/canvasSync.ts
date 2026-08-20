import { useCanvasStore, isGroupNode, type CanvasNode } from './canvasStore';
import { useTerminalStore, type TerminalDisplayState } from './terminalStore';

/**
 * Node geometry is keyed separately (see canvasStore), so dropping a node here
 * does not lose its position.
 */
export function syncCanvasWithTerminals(projectPath: string): void {
  const terminals = useTerminalStore.getState();
  useCanvasStore.getState().reconcileNodes(
    projectPath,
    (terminals.terminalsByProject[projectPath] ?? []).map((ptyId) => ({
      ptyId,
      taskId: terminals.displayStates[ptyId]?.taskId ?? null,
    })),
  );
}

/** Terminal nodes grouped by the task they belong to; a task can have several. */
export function nodesByTask(
  nodes: CanvasNode[],
  displayStates: Record<string, TerminalDisplayState>,
): Map<number, CanvasNode[]> {
  const byTask = new Map<number, CanvasNode[]>();
  for (const node of nodes) {
    if (isGroupNode(node)) continue;
    const taskId = displayStates[node.data.ptyId]?.taskId;
    if (taskId == null) continue;
    const list = byTask.get(taskId);
    if (list) list.push(node);
    else byTask.set(taskId, [node]);
  }
  return byTask;
}
