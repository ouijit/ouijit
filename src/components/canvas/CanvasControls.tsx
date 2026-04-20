import { memo, useCallback } from 'react';
import { Panel, useReactFlow, useViewport } from '@xyflow/react';
import { useCanvasStore } from '../../stores/canvasStore';

interface CanvasControlsProps {
  projectPath: string;
}

export const CanvasControls = memo(function CanvasControls({ projectPath }: CanvasControlsProps) {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const { zoom } = useViewport();
  const gridSnap = useCanvasStore((s) => s.canvasByProject[projectPath]?.gridSnap ?? false);

  const handleZoomIn = useCallback(() => zoomIn({ duration: 200 }), [zoomIn]);
  const handleZoomOut = useCallback(() => zoomOut({ duration: 200 }), [zoomOut]);
  const handleFitView = useCallback(() => fitView({ duration: 300, padding: 0.1 }), [fitView]);
  const handleToggleGrid = useCallback(
    () => useCanvasStore.getState().setGridSnap(projectPath, !gridSnap),
    [projectPath, gridSnap],
  );

  const zoomPercent = Math.round(zoom * 100);

  return (
    <Panel position="top-center" className="!m-0" style={{ top: 8 }}>
      <div
        className="glass-bevel relative flex items-center gap-0.5 px-1.5 rounded-lg border border-black/60"
        style={{
          height: 32,
          background: 'rgba(28, 28, 30, 0.8)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
      >
        <ControlButton onClick={handleZoomOut} title="Zoom out (Cmd+-)">
          <MinusIcon />
        </ControlButton>

        <button
          className="px-1.5 font-mono text-xs text-white/50 bg-transparent border-none hover:text-white/80 transition-colors duration-150"
          onClick={handleFitView}
          title="Fit view (Cmd+0)"
          style={{ minWidth: 40, textAlign: 'center' }}
        >
          {zoomPercent}%
        </button>

        <ControlButton onClick={handleZoomIn} title="Zoom in (Cmd+=)">
          <PlusIcon />
        </ControlButton>

        <div className="w-px h-4 bg-white/10 mx-0.5" />

        <ControlButton onClick={handleFitView} title="Fit all (Cmd+Shift+F)">
          <FitIcon />
        </ControlButton>

        <ControlButton onClick={handleToggleGrid} title="Toggle snap to grid" active={gridSnap}>
          <GridIcon />
        </ControlButton>
      </div>
    </Panel>
  );
});

// ── Button ──────────────────────────────────────────────────────────

function ControlButton({
  onClick,
  title,
  active,
  children,
}: {
  onClick: () => void;
  title: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`w-7 h-7 flex items-center justify-center rounded bg-transparent border-none transition-colors duration-150 ${
        active ? 'text-accent' : 'text-white/40 hover:text-white/70'
      }`}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  );
}

// ── Icons ───────────────────────────────────────────────────────────

function MinusIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function FitIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </svg>
  );
}
