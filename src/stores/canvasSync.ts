import { useCanvasStore, persistCanvas, type CanvasNode } from './canvasStore';
import { useTerminalStore } from './terminalStore';

/**
 * Reconcile canvas nodes with the terminal store — add missing, drop stale,
 * and keep loading placeholders in step. Node geometry is keyed separately
 * (see canvasStore), so dropping a node here does not lose its position.
 *
 * Removal runs first so a terminal that reopens for the same task reclaims
 * the ordinal — and therefore the position — the closed one had.
 */
export function syncCanvasWithTerminals(projectPath: string): void {
  const store = useCanvasStore.getState();
  const canvas = store.canvasByProject[projectPath];
  if (!canvas) return;

  const terminals = useTerminalStore.getState();
  const ptyIds = terminals.terminalsByProject[projectPath] ?? [];
  const live = new Set(ptyIds);
  let changed = false;

  for (const node of canvas.nodes) {
    if (node.type === 'group' || live.has(node.data.ptyId)) continue;
    store.removeNode(projectPath, node.data.ptyId);
    changed = true;
  }

  const present = new Set(
    (useCanvasStore.getState().canvasByProject[projectPath]?.nodes ?? []).map((n) => n.data.ptyId),
  );
  for (const ptyId of ptyIds) {
    if (present.has(ptyId)) continue;
    const display = terminals.displayStates[ptyId];
    store.addNode(projectPath, ptyId, {
      taskId: display?.taskId ?? null,
      loading: display?.isLoading,
      loadingLabel: display?.isLoading ? display.label : undefined,
    });
    changed = true;
  }

  const current = useCanvasStore.getState().canvasByProject[projectPath];
  if (current) {
    let loadingChanged = false;
    const nodes: CanvasNode[] = current.nodes.map((node) => {
      if (node.type === 'group') return node;
      const display = terminals.displayStates[node.data.ptyId];
      const loading = display?.isLoading ?? false;
      if (!!node.data.loading === loading) return node;
      loadingChanged = true;
      return { ...node, data: { ...node.data, loading, loadingLabel: loading ? display?.label : undefined } };
    });
    if (loadingChanged) {
      useCanvasStore.getState().setNodes(projectPath, nodes);
      changed = true;
    }
  }

  if (changed) persistCanvas(projectPath);
}
