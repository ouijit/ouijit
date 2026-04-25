import { memo, useCallback } from 'react';
import { NodeResizer, Handle, Position, type NodeProps } from '@xyflow/react';
import { type TerminalNode as TerminalNodeType } from '../../stores/canvasStore';
import { useTerminalPanels } from '../terminal/useTerminalPanels';
import { TerminalBody } from '../terminal/TerminalBody';
import { TerminalHeader } from '../terminal/TerminalHeader';
import { closeProjectTerminal } from '../terminal/terminalActions';

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
    toggleDiffPanel,
    togglePlanPanel,
    toggleWebPreviewPanel,
    toggleRunner,
    closeDiffPanel,
    collapseRunner,
    killRunner,
    restartRunner,
    closePlanPanel,
    changePlanFile,
    closeWebPreviewPanel,
    changeWebPreviewUrl,
  } = useTerminalPanels(ptyId);

  const handleClose = useCallback(() => {
    closeProjectTerminal(ptyId);
  }, [ptyId]);

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
        <div className="terminal-drag-handle shrink-0" style={{ zIndex: 2 }}>
          <TerminalHeader
            ptyId={ptyId}
            isActive
            onClose={handleClose}
            onToggleDiffPanel={toggleDiffPanel}
            onTogglePlanPanel={togglePlanPanel}
            onToggleWebPreviewPanel={toggleWebPreviewPanel}
            onToggleRunner={toggleRunner}
          />
        </div>
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
