import { memo, useCallback } from 'react';
import {
  useCanvasStore,
  persistCanvas,
  nodeWidth,
  nodeHeight,
  type CanvasNode,
  type AlignType,
  type DistributeAxis,
} from '../../stores/canvasStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { useProjectStore } from '../../stores/projectStore';
import { buildChainMap, type TaskChainInfo } from '../../utils/taskChain';
import { ContextMenu, type ContextMenuEntry } from '../ui/ContextMenu';

interface AlignMenuProps {
  projectPath: string;
  position: { x: number; y: number } | null;
  onClose: () => void;
}

/** Context menu for aligning and distributing selected nodes. */
export const AlignMenu = memo(function AlignMenu({ projectPath, position, onClose }: AlignMenuProps) {
  const handleAlign = useCallback(
    (type: AlignType) => {
      useCanvasStore.getState().alignSelected(projectPath, type);
      persistCanvas(projectPath);
    },
    [projectPath],
  );

  const handleDistribute = useCallback(
    (axis: DistributeAxis) => {
      useCanvasStore.getState().distributeSelected(projectPath, axis);
      persistCanvas(projectPath);
    },
    [projectPath],
  );

  const handleGridLayout = useCallback(() => {
    useCanvasStore.getState().gridLayoutSelected(projectPath);
    persistCanvas(projectPath);
  }, [projectPath]);

  const tasks = useProjectStore((s) => s.tasks);
  const displayStates = useTerminalStore((s) => s.displayStates);

  const handleChainLayout = useCallback(() => {
    const canvas = useCanvasStore.getState().canvasByProject[projectPath];
    if (!canvas) return;

    const chainMap = buildChainMap(tasks);
    const hGap = 80;
    const vGap = 60;

    // Build taskNumber → nodes lookup
    const taskToNodes = new Map<number, CanvasNode[]>();
    for (const node of canvas.nodes) {
      const display = displayStates[node.data.ptyId];
      if (display?.taskId != null) {
        const list = taskToNodes.get(display.taskId);
        if (list) list.push(node);
        else taskToNodes.set(display.taskId, [node]);
      }
    }

    // Only layout nodes that are part of chains
    const chainTaskNumbers = new Set<number>();
    for (const [taskNum, info] of chainMap) {
      if (info.depth > 0 || info.childTaskNumbers.length > 0) {
        chainTaskNumbers.add(taskNum);
      }
    }
    if (chainTaskNumbers.size === 0) return;

    // Find root tasks and build tree
    const roots: number[] = [];
    for (const taskNum of chainTaskNumbers) {
      const info = chainMap.get(taskNum);
      if (info && info.depth === 0) roots.push(taskNum);
    }

    // Recursive layout: each subtree returns its total height
    const positions = new Map<string, { x: number; y: number }>();

    function layoutSubtree(taskNum: number, x: number, y: number): number {
      const info = chainMap.get(taskNum);
      const nodes = taskToNodes.get(taskNum) ?? [];
      if (nodes.length === 0 && (!info || info.childTaskNumbers.length === 0)) return 0;

      // Place this task's terminals stacked vertically
      let nodeY = y;
      for (const node of nodes) {
        positions.set(node.id, { x, y: nodeY });
        nodeY += nodeHeight(node) + vGap;
      }
      const thisHeight = nodes.length > 0 ? nodeY - y - vGap : 0;

      // Layout children to the right
      if (!info || info.childTaskNumbers.length === 0) return Math.max(thisHeight, 0);

      const maxNodeWidth = nodes.length > 0 ? Math.max(...nodes.map(nodeWidth)) : 0;
      const childX = x + maxNodeWidth + hGap;

      // Center children vertically relative to this task's nodes
      let totalChildHeight = 0;
      const childHeights: number[] = [];
      // First pass: compute total height needed
      for (const childNum of info.childTaskNumbers) {
        if (!chainTaskNumbers.has(childNum)) continue;
        const h = estimateSubtreeHeight(childNum, chainMap, taskToNodes, vGap);
        childHeights.push(h);
        totalChildHeight += h;
      }
      const filteredChildren = info.childTaskNumbers.filter((c) => chainTaskNumbers.has(c));
      if (filteredChildren.length > 1) totalChildHeight += (filteredChildren.length - 1) * vGap;

      // Start children so they center on parent
      const parentCenterY = y + thisHeight / 2;
      let childY = parentCenterY - totalChildHeight / 2;

      for (let i = 0; i < filteredChildren.length; i++) {
        const actualHeight = layoutSubtree(filteredChildren[i], childX, childY);
        childY += (actualHeight > 0 ? actualHeight : childHeights[i]) + vGap;
      }

      return Math.max(thisHeight, totalChildHeight);
    }

    // Layout all root chains, stacked vertically
    const originX = Math.min(...canvas.nodes.map((n) => n.position.x));
    let currentY = Math.min(...canvas.nodes.map((n) => n.position.y));
    for (const root of roots) {
      const height = layoutSubtree(root, originX, currentY);
      currentY += height + vGap * 2;
    }

    // Apply positions (only update chain nodes, leave non-chain nodes untouched)
    const updatedNodes = canvas.nodes.map((n) => {
      const pos = positions.get(n.id);
      return pos ? { ...n, position: pos } : n;
    });

    useCanvasStore.getState().setNodes(projectPath, updatedNodes);
    persistCanvas(projectPath);
  }, [projectPath, tasks, displayStates]);

  const canvasNodes = useCanvasStore((s) => s.canvasByProject[projectPath]?.nodes);
  const selectedCount = canvasNodes?.filter((n) => n.selected).length ?? 0;

  if (!position || selectedCount < 2) return null;

  const items: ContextMenuEntry[] = [
    { label: 'Align Left', icon: 'align-left', onClick: () => handleAlign('left') },
    { label: 'Align Center', icon: 'align-center-horizontal', onClick: () => handleAlign('center-h') },
    { label: 'Align Right', icon: 'align-right', onClick: () => handleAlign('right') },
    { separator: true },
    { label: 'Align Top', icon: 'align-top', onClick: () => handleAlign('top') },
    { label: 'Align Middle', icon: 'align-center-vertical', onClick: () => handleAlign('center-v') },
    { label: 'Align Bottom', icon: 'align-bottom', onClick: () => handleAlign('bottom') },
  ];

  if (selectedCount >= 3) {
    items.push(
      { separator: true },
      {
        label: 'Distribute Horizontal',
        icon: 'arrows-out-line-horizontal',
        onClick: () => handleDistribute('horizontal'),
      },
      { label: 'Distribute Vertical', icon: 'arrows-out-line-vertical', onClick: () => handleDistribute('vertical') },
    );
  }

  items.push({ separator: true }, { label: 'Grid Layout', icon: 'grid-four', onClick: handleGridLayout });
  items.push({ label: 'Chain Tree Layout', icon: 'tree-structure', onClick: handleChainLayout });

  return <ContextMenu x={position.x} y={position.y} items={items} onClose={onClose} />;
});

/** Estimate total height of a subtree without placing nodes. */
function estimateSubtreeHeight(
  taskNum: number,
  chainMap: Map<number, TaskChainInfo>,
  taskToNodes: Map<number, CanvasNode[]>,
  vGap: number,
): number {
  const nodes = taskToNodes.get(taskNum) ?? [];
  const info = chainMap.get(taskNum);

  const thisHeight = nodes.length > 0 ? nodes.reduce((sum, n) => sum + nodeHeight(n) + vGap, 0) - vGap : 0;

  if (!info || info.childTaskNumbers.length === 0) return Math.max(thisHeight, 0);

  let childTotal = 0;
  let childCount = 0;
  for (const childNum of info.childTaskNumbers) {
    const childInfo = chainMap.get(childNum);
    if (!childInfo || (childInfo.depth === 0 && childInfo.childTaskNumbers.length === 0)) continue;
    childTotal += estimateSubtreeHeight(childNum, chainMap, taskToNodes, vGap);
    childCount++;
  }
  if (childCount > 1) childTotal += (childCount - 1) * vGap;

  return Math.max(thisHeight, childTotal);
}
