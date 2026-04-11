import { memo, useCallback, useEffect } from 'react';
import { useCanvasStore, type TerminalNode } from '../../stores/canvasStore';

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
    },
    [projectPath],
  );

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
