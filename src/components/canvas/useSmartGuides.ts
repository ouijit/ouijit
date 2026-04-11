import { useState, useCallback } from 'react';
import { useReactFlow, type OnNodeDrag } from '@xyflow/react';
import type { TerminalNode } from '../../stores/canvasStore';

export interface GuideLine {
  orientation: 'horizontal' | 'vertical';
  /** Screen-space position (px from container edge) */
  screenPos: number;
}

const SNAP_THRESHOLD = 8;
const DEFAULT_W = 720;
const DEFAULT_H = 480;

function getW(node: { measured?: { width?: number }; style?: { width?: number | string } }): number {
  return node.measured?.width ?? (node.style?.width ? Number(node.style.width) : DEFAULT_W);
}

function getH(node: { measured?: { height?: number }; style?: { height?: number | string } }): number {
  return node.measured?.height ?? (node.style?.height ? Number(node.style.height) : DEFAULT_H);
}

/**
 * Computes smart alignment guides during node drag.
 * Returns guide lines in screen-space and drag event handlers.
 */
export function useSmartGuides(nodes: TerminalNode[]) {
  const [guides, setGuides] = useState<GuideLine[]>([]);
  const { getViewport } = useReactFlow();

  const onNodeDrag: OnNodeDrag<TerminalNode> = useCallback(
    (_event, draggedNode) => {
      const { x: panX, y: panY, zoom } = getViewport();
      const matches: { orientation: 'horizontal' | 'vertical'; canvasPos: number }[] = [];

      const dLeft = draggedNode.position.x;
      const dWidth = getW(draggedNode);
      const dHeight = getH(draggedNode);
      const dRight = dLeft + dWidth;
      const dTop = draggedNode.position.y;
      const dBottom = dTop + dHeight;
      const dCenterX = dLeft + dWidth / 2;
      const dCenterY = dTop + dHeight / 2;

      for (const node of nodes) {
        if (node.id === draggedNode.id) continue;

        const nLeft = node.position.x;
        const nWidth = getW(node);
        const nHeight = getH(node);
        const nRight = nLeft + nWidth;
        const nTop = node.position.y;
        const nBottom = nTop + nHeight;
        const nCenterX = nLeft + nWidth / 2;
        const nCenterY = nTop + nHeight / 2;

        // Vertical guides (x-axis alignment)
        if (Math.abs(dLeft - nLeft) < SNAP_THRESHOLD) matches.push({ orientation: 'vertical', canvasPos: nLeft });
        if (Math.abs(dRight - nRight) < SNAP_THRESHOLD) matches.push({ orientation: 'vertical', canvasPos: nRight });
        if (Math.abs(dCenterX - nCenterX) < SNAP_THRESHOLD)
          matches.push({ orientation: 'vertical', canvasPos: nCenterX });
        if (Math.abs(dLeft - nRight) < SNAP_THRESHOLD) matches.push({ orientation: 'vertical', canvasPos: nRight });
        if (Math.abs(dRight - nLeft) < SNAP_THRESHOLD) matches.push({ orientation: 'vertical', canvasPos: nLeft });

        // Horizontal guides (y-axis alignment)
        if (Math.abs(dTop - nTop) < SNAP_THRESHOLD) matches.push({ orientation: 'horizontal', canvasPos: nTop });
        if (Math.abs(dBottom - nBottom) < SNAP_THRESHOLD)
          matches.push({ orientation: 'horizontal', canvasPos: nBottom });
        if (Math.abs(dCenterY - nCenterY) < SNAP_THRESHOLD)
          matches.push({ orientation: 'horizontal', canvasPos: nCenterY });
        if (Math.abs(dTop - nBottom) < SNAP_THRESHOLD) matches.push({ orientation: 'horizontal', canvasPos: nBottom });
        if (Math.abs(dBottom - nTop) < SNAP_THRESHOLD) matches.push({ orientation: 'horizontal', canvasPos: nTop });
      }

      // Deduplicate and convert to screen space
      const seen = new Set<string>();
      const result: GuideLine[] = [];
      for (const m of matches) {
        const key = `${m.orientation}:${m.canvasPos}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const screenPos = m.orientation === 'vertical' ? m.canvasPos * zoom + panX : m.canvasPos * zoom + panY;
        result.push({ orientation: m.orientation, screenPos });
      }

      setGuides(result);
    },
    [nodes, getViewport],
  );

  const onNodeDragStop: OnNodeDrag<TerminalNode> = useCallback(() => {
    setGuides([]);
  }, []);

  return { guides, onNodeDrag, onNodeDragStop };
}
