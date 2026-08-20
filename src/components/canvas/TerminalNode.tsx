import { memo, useCallback, useEffect, useRef } from 'react';
import { NodeResizer, Handle, Position, type NodeProps } from '@xyflow/react';
import { type GroupCanvasNode, type TerminalCanvasNode } from '../../stores/canvasStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { TerminalBody } from '../terminal/TerminalBody';
import { TerminalHeader } from '../terminal/TerminalHeader';
import { closeProjectTerminal } from '../terminal/terminalActions';

const INSET_TOP = 8;
const INSET_SIDE = 10;
const INSET_BOTTOM = 8;

export const TerminalNode = memo(function TerminalNode({ data, selected }: NodeProps<TerminalCanvasNode>) {
  const display = useTerminalStore((s) => s.displayStates[data.ptyId]);
  if (display?.isLoading) return <LoadingNode label={display.label} />;
  return <ActiveTerminalNode data={data} selected={selected} />;
});

/** Group container. Chrome only — the terminals inside it are separate nodes. */
export const GroupNode = memo(function GroupNode({ selected }: NodeProps<GroupCanvasNode>) {
  return (
    <div
      className="w-full h-full rounded-2xl"
      style={{
        background: 'color-mix(in srgb, var(--color-ink) 2%, transparent)',
        border: selected
          ? '1px dashed color-mix(in srgb, var(--color-accent) 60%, transparent)'
          : '1px dashed color-mix(in srgb, var(--color-ink) 10%, transparent)',
      }}
    />
  );
});

function LoadingNode({ label }: { label: string }) {
  return (
    <div
      className="canvas-terminal-node glass-bevel absolute rounded-[14px] border border-bezel-panel overflow-hidden flex flex-col items-center justify-center gap-3"
      style={{
        top: INSET_TOP,
        left: INSET_SIDE,
        right: INSET_SIDE,
        bottom: INSET_BOTTOM,
        background: 'var(--color-terminal-bg)',
        boxShadow: 'var(--shadow-panel)',
      }}
    >
      <div
        className="w-5 h-5 rounded-full border-2 border-ink/20 border-t-accent"
        style={{ animation: 'spin 0.8s linear infinite' }}
      />
      <span className="font-mono text-sm text-ink/40">{label || 'Setting up workspace\u2026'}</span>
    </div>
  );
}

const ActiveTerminalNode = memo(function ActiveTerminalNode({
  data,
  selected,
}: {
  data: TerminalCanvasNode['data'];
  selected?: boolean;
}) {
  const { ptyId, projectPath } = data;
  const bodyRef = useRef<HTMLDivElement>(null);

  const handleClose = useCallback(() => {
    closeProjectTerminal(ptyId);
  }, [ptyId]);

  // The terminal and the canvas both want the wheel. React Flow reads its
  // wheel events off an ancestor, so a capture-phase listener here can keep
  // plain scrolls for xterm's scrollback while letting ⌘/pinch scrolls
  // through to zoom. The `nowheel` class would take both.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.metaKey && !event.ctrlKey) event.stopPropagation();
    };
    el.addEventListener('wheel', onWheel, { capture: true });
    return () => el.removeEventListener('wheel', onWheel, { capture: true });
  }, []);

  return (
    <>
      <NodeResizer
        minWidth={400}
        minHeight={200}
        maxWidth={2400}
        maxHeight={1600}
        isVisible={!!selected}
        lineClassName="!border-0 !border-transparent"
        handleClassName="!w-3 !h-3 !bg-accent !border-0 !rounded-full"
      />
      <Handle id="top" type="source" position={Position.Top} className="!bg-transparent !border-none !w-0 !h-0" />
      <Handle id="top" type="target" position={Position.Top} className="!bg-transparent !border-none !w-0 !h-0" />
      <Handle id="bottom" type="source" position={Position.Bottom} className="!bg-transparent !border-none !w-0 !h-0" />
      <Handle id="bottom" type="target" position={Position.Bottom} className="!bg-transparent !border-none !w-0 !h-0" />
      <Handle id="left" type="source" position={Position.Left} className="!bg-transparent !border-none !w-0 !h-0" />
      <Handle id="left" type="target" position={Position.Left} className="!bg-transparent !border-none !w-0 !h-0" />
      <Handle id="right" type="source" position={Position.Right} className="!bg-transparent !border-none !w-0 !h-0" />
      <Handle id="right" type="target" position={Position.Right} className="!bg-transparent !border-none !w-0 !h-0" />

      <div
        className="canvas-terminal-node glass-bevel absolute rounded-[14px] border border-bezel-panel overflow-hidden flex flex-col"
        style={{
          top: INSET_TOP,
          left: INSET_SIDE,
          right: INSET_SIDE,
          bottom: INSET_BOTTOM,
          background: 'var(--color-terminal-bg)',
          boxShadow: 'var(--shadow-panel)',
        }}
      >
        <div className="terminal-drag-handle shrink-0" style={{ zIndex: 2 }}>
          <TerminalHeader ptyId={ptyId} isActive onClose={handleClose} />
        </div>
        <div ref={bodyRef} className="canvas-terminal-body flex flex-col flex-1 min-h-0">
          <TerminalBody ptyId={ptyId} projectPath={projectPath} />
        </div>
      </div>
    </>
  );
});
