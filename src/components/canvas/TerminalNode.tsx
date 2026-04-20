import { memo } from 'react';
import { NodeResizer, Handle, Position, useViewport, type NodeProps } from '@xyflow/react';
import { type TerminalNode as TerminalNodeType } from '../../stores/canvasStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { useTerminalPanels } from '../terminal/useTerminalPanels';
import { TerminalBody } from '../terminal/TerminalBody';

const INSET_TOP = 8;
const INSET_SIDE = 10;
const INSET_BOTTOM = 8;

export const TerminalNode = memo(function TerminalNode({ data, selected }: NodeProps<TerminalNodeType>) {
  if (data.loading) return <LoadingNode label={data.loadingLabel} />;
  return <ActiveTerminalNode data={data} selected={selected} />;
});

function LoadingNode({ label }: { label?: string }) {
  return (
    <div
      className="canvas-terminal-node glass-bevel absolute rounded-[14px] border border-black/60 overflow-hidden flex flex-col items-center justify-center gap-3"
      style={{
        top: INSET_TOP,
        left: INSET_SIDE,
        right: INSET_SIDE,
        bottom: INSET_BOTTOM,
        background: 'var(--color-terminal-bg, #171717)',
        boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.05), 0 4px 12px rgba(0, 0, 0, 0.15), 0 20px 40px rgba(0, 0, 0, 0.2)',
      }}
    >
      <div
        className="w-5 h-5 rounded-full border-2 border-white/20 border-t-accent"
        style={{ animation: 'spin 0.8s linear infinite' }}
      />
      <span className="font-mono text-sm text-white/40">{label || 'Setting up workspace\u2026'}</span>
    </div>
  );
}

const ActiveTerminalNode = memo(function ActiveTerminalNode({
  data,
  selected,
}: {
  data: TerminalNodeType['data'];
  selected?: boolean;
}) {
  const { ptyId, projectPath } = data;

  const {
    closeDiffPanel,
    collapseRunner,
    killRunner,
    restartRunner,
    closePlanPanel,
    changePlanFile,
    closeWebPreviewPanel,
    changeWebPreviewUrl,
  } = useTerminalPanels(ptyId);

  const bodyClasses = selected ? 'nodrag nowheel nopan flex flex-col flex-1 min-h-0' : 'flex flex-col flex-1 min-h-0';

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
        className="canvas-terminal-node glass-bevel absolute rounded-[14px] border border-black/60 overflow-hidden flex flex-col"
        style={{
          top: INSET_TOP,
          left: INSET_SIDE,
          right: INSET_SIDE,
          bottom: INSET_BOTTOM,
          background: 'var(--color-terminal-bg, #171717)',
          boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.05), 0 4px 12px rgba(0, 0, 0, 0.15), 0 20px 40px rgba(0, 0, 0, 0.2)',
        }}
      >
        <NodeHeader ptyId={ptyId} />
        <div className={bodyClasses} style={selected ? undefined : { pointerEvents: 'none' }}>
          <TerminalBody
            ptyId={ptyId}
            projectPath={projectPath}
            onCloseDiffPanel={closeDiffPanel}
            onClosePlanPanel={closePlanPanel}
            onChangePlanFile={changePlanFile}
            onCloseWebPreviewPanel={closeWebPreviewPanel}
            onChangeWebPreviewUrl={changeWebPreviewUrl}
            onCollapseRunner={collapseRunner}
            onKillRunner={killRunner}
            onRestartRunner={restartRunner}
          />
        </div>
      </div>
    </>
  );
});

// ── Header: status light + title, inside the card (drag handle) ─────

const NodeHeader = memo(function NodeHeader({ ptyId }: { ptyId: string }) {
  const label = useTerminalStore((s) => s.displayStates[ptyId]?.label ?? '');
  const summary = useTerminalStore((s) => s.displayStates[ptyId]?.summary ?? '');
  const summaryType = useTerminalStore((s) => s.displayStates[ptyId]?.summaryType ?? 'ready');
  const { zoom } = useViewport();

  const displayText = summary ? `${label} \u2014 ${summary}` : label || 'Shell';
  const MAX_SCALE = 1.4;
  const inverseScale = zoom > 0 ? Math.min(MAX_SCALE, Math.max(1, 1 / zoom)) : 1;

  return (
    <div className="terminal-drag-handle relative shrink-0 pl-4 pr-3 py-2.5" style={{ zIndex: 2 }}>
      <div
        className="flex items-center gap-2 min-w-0 origin-top-left"
        style={{
          transform: `scale(${inverseScale})`,
          width: `${100 / inverseScale}%`,
          willChange: 'transform',
        }}
      >
        <span
          className={`w-2.5 h-2.5 rounded-full shrink-0 transition-all duration-200 ease-out ${summaryType === 'thinking' ? 'bg-[#da77f2]' : 'bg-[#69db7c]'}`}
          data-status={summaryType}
          style={{
            boxShadow:
              summaryType === 'thinking' ? '0 0 4px rgba(218, 119, 242, 0.5)' : '0 0 4px rgba(105, 219, 124, 0.5)',
            ...(summaryType === 'thinking' ? { animation: 'terminal-status-pulse 1s ease-in-out infinite' } : {}),
          }}
        />
        <span className="font-mono text-sm font-medium text-white/85 truncate min-w-0">{displayText}</span>
      </div>
    </div>
  );
});
