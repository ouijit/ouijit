import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useReactFlow, useViewport } from '@xyflow/react';
import { useCanvasStore } from '../../stores/canvasStore';
import { KeyHint } from '../ui/KeyHint';

const isMac = navigator.platform.toLowerCase().includes('mac');
const mod = isMac ? '⌘' : 'Ctrl';

const SHORTCUTS: Array<{ keys: string; label: string }> = [
  { keys: `${mod}L`, label: 'Switch between stack and canvas' },
  { keys: `${mod}G`, label: 'Group the selected terminals' },
  { keys: `${mod}⇧G`, label: 'Ungroup' },
  { keys: 'Space + drag', label: 'Pan' },
  { keys: `${mod} + scroll`, label: 'Zoom' },
  { keys: 'Shift + drag', label: 'Select a region' },
  { keys: 'Double-click', label: 'Frame a terminal' },
  { keys: 'Right-click', label: 'Align and distribute a selection' },
];

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

  const [helpOpen, setHelpOpen] = useState(false);
  const handleToggleHelp = useCallback(() => setHelpOpen((v) => !v), []);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!helpOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setHelpOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setHelpOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [helpOpen]);

  return (
    <div
      ref={barRef}
      className="glass-bevel flex items-center gap-0.5 px-1.5 rounded-lg border border-bezel"
      style={{
        position: 'absolute',
        top: 8,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 10001,
        height: 32,
        background: 'color-mix(in srgb, var(--color-background) 80%, transparent)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
    >
      <ControlButton onClick={handleZoomOut} title="Zoom out (Cmd+-)">
        <MinusIcon />
      </ControlButton>

      <button
        className="px-1.5 font-mono text-xs text-ink/50 bg-transparent border-none hover:text-ink/80 transition-colors duration-150"
        onClick={handleFitView}
        title="Fit view (Cmd+0)"
        style={{ minWidth: 40, textAlign: 'center' }}
      >
        {zoomPercent}%
      </button>

      <ControlButton onClick={handleZoomIn} title="Zoom in (Cmd+=)">
        <PlusIcon />
      </ControlButton>

      <div className="w-px h-4 bg-ink/10 mx-0.5" />

      <ControlButton onClick={handleFitView} title="Fit all (Cmd+Shift+F)">
        <FitIcon />
      </ControlButton>

      <ControlButton onClick={handleToggleGrid} title="Toggle snap to grid" active={gridSnap}>
        <GridIcon />
      </ControlButton>

      <ControlButton onClick={handleToggleHelp} title="Canvas shortcuts" active={helpOpen}>
        <HelpIcon />
      </ControlButton>

      {helpOpen && (
        <div
          className="glass-bevel absolute left-1/2 -translate-x-1/2 top-10 w-[19rem] p-3 rounded-xl border border-bezel flex flex-col gap-2 text-xs text-text-secondary"
          style={{
            background: 'color-mix(in srgb, var(--color-background) 92%, transparent)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            boxShadow: 'var(--shadow-menu)',
          }}
        >
          {SHORTCUTS.map((s) => (
            <KeyHint key={s.keys} keys={s.keys} label={s.label} />
          ))}
        </div>
      )}
    </div>
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
        active ? 'text-accent' : 'text-ink/40 hover:text-ink/70'
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

function HelpIcon() {
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
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.2 2.4c-.6.2-.9.7-.9 1.3v.3" />
      <line x1="12" y1="17" x2="12" y2="17" />
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
