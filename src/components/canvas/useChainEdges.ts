import { useEffect } from 'react';
import { Position, type Edge } from '@xyflow/react';
import { useProjectStore } from '../../stores/projectStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { useCanvasStore, persistCanvas, type TerminalNode } from '../../stores/canvasStore';
import { buildChainMap, getChainColor } from '../../utils/taskChain';

const DEFAULT_W = 720;
const DEFAULT_H = 480;

interface NodeRect {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
}

function getNodeRect(node: TerminalNode): NodeRect {
  const w = node.measured?.width ?? (node.style?.width ? Number(node.style.width) : DEFAULT_W);
  const h = node.measured?.height ?? (node.style?.height ? Number(node.style.height) : DEFAULT_H);
  return {
    x: node.position.x,
    y: node.position.y,
    w,
    h,
    cx: node.position.x + w / 2,
    cy: node.position.y + h / 2,
  };
}

/** Determine which side of each node to connect, based on relative position. */
function getClosestSides(
  source: NodeRect,
  target: NodeRect,
): { sourceHandle: string; targetHandle: string; sourcePosition: Position; targetPosition: Position } {
  const dx = target.cx - source.cx;
  const dy = target.cy - source.cy;

  // Use the axis with the greater distance to pick sides
  if (Math.abs(dx) > Math.abs(dy)) {
    // Horizontal relationship
    if (dx > 0) {
      return {
        sourceHandle: 'right',
        targetHandle: 'left',
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      };
    }
    return {
      sourceHandle: 'left',
      targetHandle: 'right',
      sourcePosition: Position.Left,
      targetPosition: Position.Right,
    };
  }
  // Vertical relationship
  if (dy > 0) {
    return {
      sourceHandle: 'bottom',
      targetHandle: 'top',
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
    };
  }
  return { sourceHandle: 'top', targetHandle: 'bottom', sourcePosition: Position.Top, targetPosition: Position.Bottom };
}

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

    // Build taskNumber -> node lookup from terminals on canvas
    const taskToNode = new Map<number, TerminalNode>();
    for (const node of canvasNodes) {
      const ptyId = node.data.ptyId;
      const display = displayStates[ptyId];
      if (display?.taskId != null) {
        taskToNode.set(display.taskId, node);
      }
    }

    // Compute edges for parent-child pairs where both have terminals on canvas
    const edges: Edge[] = [];
    for (const task of tasks) {
      if (task.parentTaskNumber == null) continue;

      const childNode = taskToNode.get(task.taskNumber);
      const parentNode = taskToNode.get(task.parentTaskNumber);
      if (!childNode || !parentNode) continue;

      const chainInfo = chainMap.get(task.taskNumber);
      if (!chainInfo) continue;

      const color = getChainColor(chainInfo.rootTaskNumber, chainInfo.depth);
      const sourceRect = getNodeRect(parentNode);
      const targetRect = getNodeRect(childNode);
      const { sourceHandle, targetHandle, sourcePosition, targetPosition } = getClosestSides(sourceRect, targetRect);

      edges.push({
        id: `chain-${parentNode.id}-${childNode.id}`,
        source: parentNode.id,
        target: childNode.id,
        sourceHandle,
        targetHandle,
        type: 'chain',
        data: { sourcePosition, targetPosition },
        style: { stroke: color, strokeWidth: 2, strokeLinecap: 'round' },
      });
    }

    // Only update if edges actually changed
    const current = useCanvasStore.getState().canvasByProject[projectPath]?.edges ?? [];
    const changed =
      edges.length !== current.length ||
      edges.some(
        (e, i) =>
          e.id !== current[i]?.id ||
          e.sourceHandle !== current[i]?.sourceHandle ||
          e.targetHandle !== current[i]?.targetHandle,
      );

    if (changed) {
      useCanvasStore.getState().setEdges(projectPath, edges);
      persistCanvas(projectPath);
    }
  }, [tasks, displayStates, canvasNodes, projectPath]);
}
