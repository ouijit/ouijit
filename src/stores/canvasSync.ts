import { useCanvasStore, persistCanvas } from './canvasStore';
import { useTerminalStore } from './terminalStore';

/**
 * Reconcile canvas nodes with the terminal store — add missing, drop stale.
 * Node geometry is keyed separately (see canvasStore), so dropping a node
 * here does not lose its position.
 */
export function syncCanvasWithTerminals(projectPath: string): void {
  const terminals = useTerminalStore.getState();
  const changed = useCanvasStore.getState().reconcileNodes(
    projectPath,
    (terminals.terminalsByProject[projectPath] ?? []).map((ptyId) => ({
      ptyId,
      taskId: terminals.displayStates[ptyId]?.taskId ?? null,
    })),
  );
  if (changed) persistCanvas(projectPath);
}
