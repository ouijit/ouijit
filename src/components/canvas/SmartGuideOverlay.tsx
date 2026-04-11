import { memo } from 'react';
import { useViewport } from '@xyflow/react';
import type { GuideLine } from './useSmartGuides';

interface SmartGuideOverlayProps {
  guides: GuideLine[];
}

/** Renders alignment guide lines during node drag. */
export const SmartGuideOverlay = memo(function SmartGuideOverlay({ guides }: SmartGuideOverlayProps) {
  const viewport = useViewport();

  if (guides.length === 0) return null;

  // Convert canvas-space positions to screen-space for SVG overlay
  const { x: panX, y: panY, zoom } = viewport;

  return (
    <svg
      className="pointer-events-none"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        zIndex: 1000,
        overflow: 'visible',
      }}
    >
      {guides.map((guide, i) => {
        if (guide.orientation === 'vertical') {
          const screenX = guide.position * zoom + panX;
          return (
            <line
              key={`v-${i}`}
              x1={screenX}
              y1={0}
              x2={screenX}
              y2="100%"
              stroke="rgba(10, 132, 255, 0.5)"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
          );
        } else {
          const screenY = guide.position * zoom + panY;
          return (
            <line
              key={`h-${i}`}
              x1={0}
              y1={screenY}
              x2="100%"
              y2={screenY}
              stroke="rgba(10, 132, 255, 0.5)"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
          );
        }
      })}
    </svg>
  );
});
