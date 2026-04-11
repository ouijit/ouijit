import { memo } from 'react';
import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';

/** Custom edge for task chain connections. Renders a bezier curve with chain-colored stroke and arrow. */
export const ChainEdge = memo(function ChainEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
}: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  return <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />;
});
