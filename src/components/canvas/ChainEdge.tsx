import { memo } from 'react';
import { BaseEdge, getBezierPath, type EdgeProps, type Position } from '@xyflow/react';

/** Smooth bezier edge for task chain connections. */
export const ChainEdge = memo(function ChainEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  data,
}: EdgeProps) {
  const edgeData = data as { sourcePosition?: Position; targetPosition?: Position } | undefined;
  const srcPos = edgeData?.sourcePosition ?? sourcePosition;
  const tgtPos = edgeData?.targetPosition ?? targetPosition;
  const strokeColor = (style as React.CSSProperties | undefined)?.stroke;

  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition: srcPos,
    targetPosition: tgtPos,
  });

  return (
    <>
      {strokeColor && (
        <path d={edgePath} fill="none" stroke={String(strokeColor)} strokeWidth={6} strokeOpacity={0.08} />
      )}
      <BaseEdge path={edgePath} style={style} />
    </>
  );
});
