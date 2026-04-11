import { memo, useCallback } from 'react';
import { NodeResizer, Handle, Position, type NodeProps } from '@xyflow/react';
import type { TerminalNode as TerminalNodeType } from '../../stores/canvasStore';
import { useTerminalPanels } from '../terminal/useTerminalPanels';
import { terminalInstances } from '../terminal/terminalReact';
import { useTerminalStore } from '../../stores/terminalStore';
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
    const instance = terminalInstances.get(ptyId);
    if (instance) {
      instance.dispose();
    }
    useTerminalStore.getState().removeTerminal(ptyId);
  }, [ptyId]);

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
      <Handle type="target" position={Position.Top} className="!bg-transparent !border-none !w-0 !h-0" />
      <Handle type="source" position={Position.Bottom} className="!bg-transparent !border-none !w-0 !h-0" />

      <div className="terminal-drag-handle">
        <TerminalHeader
          ptyId={ptyId}
          isActive={!!selected}
          onClose={handleClose}
          onToggleDiffPanel={toggleDiffPanel}
          onTogglePlanPanel={togglePlanPanel}
          onToggleRunner={toggleRunner}
        />
      </div>

      <div className="nodrag nowheel nopan flex-1 min-h-0">
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
