import { useState, useCallback } from 'react';
import type { OnNodeDrag } from '@xyflow/react';
import type { TerminalNode } from '../../stores/canvasStore';

export interface GuideLine {
  orientation: 'horizontal' | 'vertical';
  position: number; // y for horizontal, x for vertical
}

const SNAP_THRESHOLD = 8;

/**
 * Computes smart alignment guides during node drag.
 * Returns guide lines to render and drag event handlers.
 */
export function useSmartGuides(nodes: TerminalNode[]) {
  const [guides, setGuides] = useState<GuideLine[]>([]);

  const onNodeDrag: OnNodeDrag<TerminalNode> = useCallback(
    (_event, draggedNode) => {
      const newGuides: GuideLine[] = [];

      const dLeft = draggedNode.position.x;
      const dWidth = draggedNode.measured?.width ?? (draggedNode.style?.width ? Number(draggedNode.style.width) : 720);
      const dHeight =
        draggedNode.measured?.height ?? (draggedNode.style?.height ? Number(draggedNode.style.height) : 480);
      const dRight = dLeft + dWidth;
      const dTop = draggedNode.position.y;
      const dBottom = dTop + dHeight;
      const dCenterX = dLeft + dWidth / 2;
      const dCenterY = dTop + dHeight / 2;

      for (const node of nodes) {
        if (node.id === draggedNode.id) continue;

        const nLeft = node.position.x;
        const nWidth = node.measured?.width ?? (node.style?.width ? Number(node.style.width) : 720);
        const nHeight = node.measured?.height ?? (node.style?.height ? Number(node.style.height) : 480);
        const nRight = nLeft + nWidth;
        const nTop = node.position.y;
        const nBottom = nTop + nHeight;
        const nCenterX = nLeft + nWidth / 2;
        const nCenterY = nTop + nHeight / 2;

        // Vertical guides (x-axis alignment)
        if (Math.abs(dLeft - nLeft) < SNAP_THRESHOLD) {
          newGuides.push({ orientation: 'vertical', position: nLeft });
        }
        if (Math.abs(dRight - nRight) < SNAP_THRESHOLD) {
          newGuides.push({ orientation: 'vertical', position: nRight });
        }
        if (Math.abs(dCenterX - nCenterX) < SNAP_THRESHOLD) {
          newGuides.push({ orientation: 'vertical', position: nCenterX });
        }
        if (Math.abs(dLeft - nRight) < SNAP_THRESHOLD) {
          newGuides.push({ orientation: 'vertical', position: nRight });
        }
        if (Math.abs(dRight - nLeft) < SNAP_THRESHOLD) {
          newGuides.push({ orientation: 'vertical', position: nLeft });
        }

        // Horizontal guides (y-axis alignment)
        if (Math.abs(dTop - nTop) < SNAP_THRESHOLD) {
          newGuides.push({ orientation: 'horizontal', position: nTop });
        }
        if (Math.abs(dBottom - nBottom) < SNAP_THRESHOLD) {
          newGuides.push({ orientation: 'horizontal', position: nBottom });
        }
        if (Math.abs(dCenterY - nCenterY) < SNAP_THRESHOLD) {
          newGuides.push({ orientation: 'horizontal', position: nCenterY });
        }
        if (Math.abs(dTop - nBottom) < SNAP_THRESHOLD) {
          newGuides.push({ orientation: 'horizontal', position: nBottom });
        }
        if (Math.abs(dBottom - nTop) < SNAP_THRESHOLD) {
          newGuides.push({ orientation: 'horizontal', position: nTop });
        }
      }

      // Deduplicate
      const unique = newGuides.filter(
        (g, i, arr) => arr.findIndex((o) => o.orientation === g.orientation && o.position === g.position) === i,
      );

      setGuides(unique);
    },
    [nodes],
  );

  const onNodeDragStop: OnNodeDrag<TerminalNode> = useCallback(() => {
    setGuides([]);
  }, []);

  return { guides, onNodeDrag, onNodeDragStop };
}
