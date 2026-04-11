import { memo, useCallback, useEffect } from 'react';
import { useCanvasStore, persistCanvas, type TerminalNode } from '../../stores/canvasStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { useProjectStore } from '../../stores/projectStore';
import { buildChainMap, type TaskChainInfo } from '../../utils/taskChain';

interface AlignMenuProps {
  projectPath: string;
  position: { x: number; y: number } | null;
  onClose: () => void;
}

type AlignType = 'left' | 'center-h' | 'right' | 'top' | 'center-v' | 'bottom';
type DistributeType = 'horizontal' | 'vertical';

/** Context menu for aligning and distributing selected nodes. */
export const AlignMenu = memo(function AlignMenu({ projectPath, position, onClose }: AlignMenuProps) {
  // Close on click outside or Escape
  useEffect(() => {
    if (!position) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const clickHandler = () => {
      // Delay to allow menu item clicks to fire first
      requestAnimationFrame(() => onClose());
    };
    document.addEventListener('keydown', handler);
    document.addEventListener('mousedown', clickHandler);
    return () => {
      document.removeEventListener('keydown', handler);
      document.removeEventListener('mousedown', clickHandler);
    };
  }, [position, onClose]);

  const handleAlign = useCallback(
    (type: AlignType) => {
      const canvas = useCanvasStore.getState().canvasByProject[projectPath];
      if (!canvas) return;
      const selected = canvas.nodes.filter((n) => n.selected);
      if (selected.length < 2) return;

      const getWidth = (n: TerminalNode) => n.measured?.width ?? (n.style?.width ? Number(n.style.width) : 720);
      const getHeight = (n: TerminalNode) => n.measured?.height ?? (n.style?.height ? Number(n.style.height) : 480);

      let updatedNodes = [...canvas.nodes];

      switch (type) {
        case 'left': {
          const minX = Math.min(...selected.map((n) => n.position.x));
          updatedNodes = updatedNodes.map((n) => (n.selected ? { ...n, position: { ...n.position, x: minX } } : n));
          break;
        }
        case 'right': {
          const maxRight = Math.max(...selected.map((n) => n.position.x + getWidth(n)));
          updatedNodes = updatedNodes.map((n) =>
            n.selected ? { ...n, position: { ...n.position, x: maxRight - getWidth(n) } } : n,
          );
          break;
        }
        case 'center-h': {
          const centerX =
            (Math.min(...selected.map((n) => n.position.x)) +
              Math.max(...selected.map((n) => n.position.x + getWidth(n)))) /
            2;
          updatedNodes = updatedNodes.map((n) =>
            n.selected ? { ...n, position: { ...n.position, x: centerX - getWidth(n) / 2 } } : n,
          );
          break;
        }
        case 'top': {
          const minY = Math.min(...selected.map((n) => n.position.y));
          updatedNodes = updatedNodes.map((n) => (n.selected ? { ...n, position: { ...n.position, y: minY } } : n));
          break;
        }
        case 'bottom': {
          const maxBottom = Math.max(...selected.map((n) => n.position.y + getHeight(n)));
          updatedNodes = updatedNodes.map((n) =>
            n.selected ? { ...n, position: { ...n.position, y: maxBottom - getHeight(n) } } : n,
          );
          break;
        }
        case 'center-v': {
          const centerY =
            (Math.min(...selected.map((n) => n.position.y)) +
              Math.max(...selected.map((n) => n.position.y + getHeight(n)))) /
            2;
          updatedNodes = updatedNodes.map((n) =>
            n.selected ? { ...n, position: { ...n.position, y: centerY - getHeight(n) / 2 } } : n,
          );
          break;
        }
      }

      useCanvasStore.getState().loadCanvas(projectPath, { ...canvas, nodes: updatedNodes as TerminalNode[] });
      persistCanvas(projectPath);
    },
    [projectPath],
  );

  const handleDistribute = useCallback(
    (type: DistributeType) => {
      const canvas = useCanvasStore.getState().canvasByProject[projectPath];
      if (!canvas) return;
      const selected = canvas.nodes.filter((n) => n.selected);
      if (selected.length < 3) return;

      const getWidth = (n: TerminalNode) => n.measured?.width ?? (n.style?.width ? Number(n.style.width) : 720);
      const getHeight = (n: TerminalNode) => n.measured?.height ?? (n.style?.height ? Number(n.style.height) : 480);

      let updatedNodes = [...canvas.nodes];

      if (type === 'horizontal') {
        const sorted = [...selected].sort((a, b) => a.position.x - b.position.x);
        const totalWidth = sorted.reduce((sum, n) => sum + getWidth(n), 0);
        const minX = sorted[0].position.x;
        const maxRight = sorted[sorted.length - 1].position.x + getWidth(sorted[sorted.length - 1]);
        const spacing = (maxRight - minX - totalWidth) / (sorted.length - 1);

        let currentX = minX;
        const positions = new Map<string, number>();
        for (const node of sorted) {
          positions.set(node.id, currentX);
          currentX += getWidth(node) + spacing;
        }

        updatedNodes = updatedNodes.map((n) =>
          positions.has(n.id) ? { ...n, position: { ...n.position, x: positions.get(n.id)! } } : n,
        );
      } else {
        const sorted = [...selected].sort((a, b) => a.position.y - b.position.y);
        const totalHeight = sorted.reduce((sum, n) => sum + getHeight(n), 0);
        const minY = sorted[0].position.y;
        const maxBottom = sorted[sorted.length - 1].position.y + getHeight(sorted[sorted.length - 1]);
        const spacing = (maxBottom - minY - totalHeight) / (sorted.length - 1);

        let currentY = minY;
        const positions = new Map<string, number>();
        for (const node of sorted) {
          positions.set(node.id, currentY);
          currentY += getHeight(node) + spacing;
        }

        updatedNodes = updatedNodes.map((n) =>
          positions.has(n.id) ? { ...n, position: { ...n.position, y: positions.get(n.id)! } } : n,
        );
      }

      useCanvasStore.getState().loadCanvas(projectPath, { ...canvas, nodes: updatedNodes as TerminalNode[] });
      persistCanvas(projectPath);
    },
    [projectPath],
  );

  const tasks = useProjectStore((s) => s.tasks);
  const displayStates = useTerminalStore((s) => s.displayStates);

  const handleGridLayout = useCallback(() => {
    const canvas = useCanvasStore.getState().canvasByProject[projectPath];
    if (!canvas) return;
    const selected = canvas.nodes.filter((n) => n.selected);
    if (selected.length < 2) return;

    const getWidth = (n: TerminalNode) => n.measured?.width ?? (n.style?.width ? Number(n.style.width) : 740);
    const getHeight = (n: TerminalNode) => n.measured?.height ?? (n.style?.height ? Number(n.style.height) : 556);
    const gap = 24;

    // Grid dimensions: prefer wider than tall
    const cols = Math.ceil(Math.sqrt(selected.length));
    const sorted = [...selected].sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);

    // Compute column widths and row heights
    const colWidths: number[] = [];
    const rowHeights: number[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      colWidths[col] = Math.max(colWidths[col] ?? 0, getWidth(sorted[i]));
      rowHeights[row] = Math.max(rowHeights[row] ?? 0, getHeight(sorted[i]));
    }

    // Place from the top-left of the current bounding box
    const originX = Math.min(...selected.map((n) => n.position.x));
    const originY = Math.min(...selected.map((n) => n.position.y));

    const positions = new Map<string, { x: number; y: number }>();
    for (let i = 0; i < sorted.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = originX + colWidths.slice(0, col).reduce((s, w) => s + w + gap, 0);
      const y = originY + rowHeights.slice(0, row).reduce((s, h) => s + h + gap, 0);
      positions.set(sorted[i].id, { x, y });
    }

    const updatedNodes = canvas.nodes.map((n) => {
      const pos = positions.get(n.id);
      return pos ? { ...n, position: pos } : n;
    });

    useCanvasStore.getState().loadCanvas(projectPath, { ...canvas, nodes: updatedNodes as TerminalNode[] });
    persistCanvas(projectPath);
  }, [projectPath]);

  const handleChainLayout = useCallback(() => {
    const canvas = useCanvasStore.getState().canvasByProject[projectPath];
    if (!canvas) return;

    const chainMap = buildChainMap(tasks);
    const getWidth = (n: TerminalNode) => n.measured?.width ?? (n.style?.width ? Number(n.style.width) : 740);
    const getHeight = (n: TerminalNode) => n.measured?.height ?? (n.style?.height ? Number(n.style.height) : 556);
    const hGap = 80;
    const vGap = 60;

    // Build taskNumber → nodes lookup
    const taskToNodes = new Map<number, TerminalNode[]>();
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
        nodeY += getHeight(node) + vGap;
      }
      const thisHeight = nodes.length > 0 ? nodeY - y - vGap : 0;

      // Layout children to the right
      if (!info || info.childTaskNumbers.length === 0) return Math.max(thisHeight, 0);

      const maxNodeWidth = nodes.length > 0 ? Math.max(...nodes.map(getWidth)) : 0;
      const childX = x + maxNodeWidth + hGap;

      // Center children vertically relative to this task's nodes
      let totalChildHeight = 0;
      const childHeights: number[] = [];
      // First pass: compute total height needed
      for (const childNum of info.childTaskNumbers) {
        if (!chainTaskNumbers.has(childNum)) continue;
        const h = estimateSubtreeHeight(childNum, chainMap, taskToNodes, getHeight, vGap);
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

    useCanvasStore.getState().loadCanvas(projectPath, { ...canvas, nodes: updatedNodes as TerminalNode[] });
    persistCanvas(projectPath);
  }, [projectPath, tasks, displayStates]);

  if (!position) return null;

  return (
    <div
      className="fixed z-[200] rounded-lg border border-white/10 py-1 min-w-[160px]"
      style={{
        left: position.x,
        top: position.y,
        background: 'rgba(28, 28, 30, 0.95)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <MenuLabel>Align</MenuLabel>
      <MenuItem onClick={() => handleAlign('left')}>Left</MenuItem>
      <MenuItem onClick={() => handleAlign('center-h')}>Center Horizontal</MenuItem>
      <MenuItem onClick={() => handleAlign('right')}>Right</MenuItem>
      <MenuDivider />
      <MenuItem onClick={() => handleAlign('top')}>Top</MenuItem>
      <MenuItem onClick={() => handleAlign('center-v')}>Center Vertical</MenuItem>
      <MenuItem onClick={() => handleAlign('bottom')}>Bottom</MenuItem>
      <MenuDivider />
      <MenuLabel>Distribute</MenuLabel>
      <MenuItem onClick={() => handleDistribute('horizontal')}>Horizontal Spacing</MenuItem>
      <MenuItem onClick={() => handleDistribute('vertical')}>Vertical Spacing</MenuItem>
      <MenuDivider />
      <MenuLabel>Layout</MenuLabel>
      <MenuItem onClick={handleGridLayout}>Grid</MenuItem>
      <MenuItem onClick={handleChainLayout}>Chain Tree</MenuItem>
    </div>
  );
});

function MenuLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-1 text-xs font-medium text-white/30">{children}</div>;
}

function MenuItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      className="w-full text-left px-3 py-1.5 text-sm text-white/70 bg-transparent border-none hover:bg-white/5 hover:text-white/90 transition-colors duration-100"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

function MenuDivider() {
  return <div className="my-1 border-t border-white/5" />;
}

/** Estimate total height of a subtree without placing nodes. */
function estimateSubtreeHeight(
  taskNum: number,
  chainMap: Map<number, TaskChainInfo>,
  taskToNodes: Map<number, TerminalNode[]>,
  getHeight: (n: TerminalNode) => number,
  vGap: number,
): number {
  const nodes = taskToNodes.get(taskNum) ?? [];
  const info = chainMap.get(taskNum);

  const thisHeight = nodes.length > 0 ? nodes.reduce((sum, n) => sum + getHeight(n) + vGap, 0) - vGap : 0;

  if (!info || info.childTaskNumbers.length === 0) return Math.max(thisHeight, 0);

  let childTotal = 0;
  let childCount = 0;
  for (const childNum of info.childTaskNumbers) {
    const childInfo = chainMap.get(childNum);
    if (!childInfo || (childInfo.depth === 0 && childInfo.childTaskNumbers.length === 0)) continue;
    childTotal += estimateSubtreeHeight(childNum, chainMap, taskToNodes, getHeight, vGap);
    childCount++;
  }
  if (childCount > 1) childTotal += (childCount - 1) * vGap;

  return Math.max(thisHeight, childTotal);
}
