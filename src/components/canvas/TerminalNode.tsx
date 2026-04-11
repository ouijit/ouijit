import { memo, useCallback } from 'react';
import { NodeResizer, Handle, Position, type NodeProps } from '@xyflow/react';
import type { TerminalNode as TerminalNodeType } from '../../stores/canvasStore';
import { useTerminalPanels } from '../terminal/useTerminalPanels';
import { closeProjectTerminal } from '../terminal/terminalActions';
import { TerminalHeader } from '../terminal/TerminalHeader';
import { TerminalBody } from '../terminal/TerminalBody';

export const TerminalNode = memo(function TerminalNode({ data, selected }: NodeProps<TerminalNodeType>) {
  const { ptyId, projectPath } = data;

  const {
    toggleDiffPanel,
    closeDiffPanel,
    toggleRunner,
    collapseRunner,
    killRunner,
    restartRunner,
    togglePlanPanel,
    closePlanPanel,
    changePlanFile,
  } = useTerminalPanels(ptyId);

  const handleClose = useCallback(() => {
    closeProjectTerminal(ptyId);
  }, [ptyId]);

  // Only intercept canvas gestures when this node is selected.
  // Unselected terminals let pan/zoom pass through to the canvas.
  const bodyClasses = selected ? 'nodrag nowheel nopan flex-1 min-h-0' : 'flex-1 min-h-0';

  return (
    <div
      className={`canvas-terminal-node rounded-[14px] border overflow-hidden flex flex-col ${
        selected ? 'border-accent/40' : 'border-white/10'
      }`}
      style={{
        width: '100%',
        height: '100%',
        background: 'var(--color-terminal-bg, #171717)',
      }}
    >
      <NodeResizer
        minWidth={400}
        minHeight={200}
        maxWidth={2400}
        maxHeight={1600}
        isVisible={!!selected}
        lineClassName="!border-accent/30"
        handleClassName="!w-2 !h-2 !bg-accent/50 !border-none !rounded-sm"
      />
      {/* Handles on all 4 sides for dynamic closest-side edge routing */}
      <Handle id="top" type="source" position={Position.Top} className="!bg-transparent !border-none !w-0 !h-0" />
      <Handle id="top" type="target" position={Position.Top} className="!bg-transparent !border-none !w-0 !h-0" />
      <Handle id="bottom" type="source" position={Position.Bottom} className="!bg-transparent !border-none !w-0 !h-0" />
      <Handle id="bottom" type="target" position={Position.Bottom} className="!bg-transparent !border-none !w-0 !h-0" />
      <Handle id="left" type="source" position={Position.Left} className="!bg-transparent !border-none !w-0 !h-0" />
      <Handle id="left" type="target" position={Position.Left} className="!bg-transparent !border-none !w-0 !h-0" />
      <Handle id="right" type="source" position={Position.Right} className="!bg-transparent !border-none !w-0 !h-0" />
      <Handle id="right" type="target" position={Position.Right} className="!bg-transparent !border-none !w-0 !h-0" />

      <div className="terminal-drag-handle">
        <TerminalHeader
          ptyId={ptyId}
          isActive
          onClose={handleClose}
          onToggleDiffPanel={toggleDiffPanel}
          onTogglePlanPanel={togglePlanPanel}
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
          onCollapseRunner={collapseRunner}
          onKillRunner={killRunner}
          onRestartRunner={restartRunner}
        />
      </div>
    </div>
  );
});
