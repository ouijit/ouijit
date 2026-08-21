import { useCanvasStore } from './canvasStore';
import { useTerminalStore } from './terminalStore';

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
