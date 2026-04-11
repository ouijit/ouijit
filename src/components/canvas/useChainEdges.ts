import { useEffect } from 'react';
import { MarkerType, type Edge } from '@xyflow/react';
import { useProjectStore } from '../../stores/projectStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { useCanvasStore, persistCanvas } from '../../stores/canvasStore';
import { buildChainMap, getChainColor } from '../../utils/taskChain';

/**
 * Computes react-flow edges from task chain relationships
 * and syncs them into canvasStore whenever tasks or terminals change.
 */
export function useChainEdges(projectPath: string): void {
  const tasks = useProjectStore((s) => s.tasks);
  const displayStates = useTerminalStore((s) => s.displayStates);
  const canvasNodes = useCanvasStore((s) => s.canvasByProject[projectPath]?.nodes);

  useEffect(() => {
    if (!canvasNodes || canvasNodes.length === 0) return;

    // Build task chain map
    const chainMap = buildChainMap(tasks);

    // Build taskNumber -> ptyId lookup from terminals on canvas
    const taskToPtyId = new Map<number, string>();
    for (const node of canvasNodes) {
      const ptyId = node.data.ptyId;
      const display = displayStates[ptyId];
      if (display?.taskId != null) {
        taskToPtyId.set(display.taskId, ptyId);
      }
    }

    // Compute edges for parent-child pairs where both have terminals on canvas
    const edges: Edge[] = [];
    for (const task of tasks) {
      if (task.parentTaskNumber == null) continue;

      const childPtyId = taskToPtyId.get(task.taskNumber);
      const parentPtyId = taskToPtyId.get(task.parentTaskNumber);
      if (!childPtyId || !parentPtyId) continue;

      const chainInfo = chainMap.get(task.taskNumber);
      if (!chainInfo) continue;

      const color = getChainColor(chainInfo.rootTaskNumber, chainInfo.depth);

      edges.push({
        id: `chain-${parentPtyId}-${childPtyId}`,
        source: parentPtyId,
        target: childPtyId,
        type: 'chain',
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
        style: { stroke: color, strokeWidth: 2 },
      });
    }

    // Only update if edges actually changed (avoid infinite loops)
    const current = useCanvasStore.getState().canvasByProject[projectPath]?.edges ?? [];
    const changed =
      edges.length !== current.length ||
      edges.some((e, i) => e.id !== current[i]?.id || e.style?.stroke !== (current[i]?.style as any)?.stroke);

    if (changed) {
      useCanvasStore.getState().setEdges(projectPath, edges);
      persistCanvas(projectPath);
    }
  }, [tasks, displayStates, canvasNodes, projectPath]);
}
