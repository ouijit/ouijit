import { memo } from 'react';
import { Panel } from '@xyflow/react';
import type { GuideLine } from './useSmartGuides';

interface SmartGuideOverlayProps {
  guides: GuideLine[];
}

/**
 * Renders alignment guide lines during node drag.
 * Uses a full-viewport SVG panel so lines span the entire visible area.
 * Coordinates are in screen space (converted from canvas space in useSmartGuides).
 */
export const SmartGuideOverlay = memo(function SmartGuideOverlay({ guides }: SmartGuideOverlayProps) {
  if (guides.length === 0) return null;

  return (
    <Panel position="top-left" className="!m-0 !p-0" style={{ inset: 0, width: '100%', height: '100%' }}>
      <svg
        className="pointer-events-none"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}
      >
        {guides.map((guide, i) =>
          guide.orientation === 'vertical' ? (
            <line
              key={`v-${i}`}
              x1={guide.screenPos}
              y1={0}
              x2={guide.screenPos}
              y2="100%"
              stroke="rgba(10, 132, 255, 0.5)"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
          ) : (
            <line
              key={`h-${i}`}
              x1={0}
              y1={guide.screenPos}
              x2="100%"
              y2={guide.screenPos}
              stroke="rgba(10, 132, 255, 0.5)"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
          ),
        )}
      </svg>
    </Panel>
  );
});
