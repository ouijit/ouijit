import { memo, useCallback } from 'react';
import { NodeResizer, Handle, Position, type NodeProps } from '@xyflow/react';
import type { TerminalNode as TerminalNodeType } from '../../stores/canvasStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTerminalPanels } from '../terminal/useTerminalPanels';
import { closeProjectTerminal } from '../terminal/terminalActions';
import { TerminalHeader } from '../terminal/TerminalHeader';
import { TerminalBody } from '../terminal/TerminalBody';
import { Icon } from '../terminal/Icon';
import { buildChainMap, getChainColor, getChainBgColor, isChainMember } from '../../utils/taskChain';

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
  const bodyClasses = selected ? 'nodrag nowheel nopan flex-1 min-h-0' : 'flex-1 min-h-0';

  return (
    <>
      <NodeTitle ptyId={ptyId} />
      <div
        className={`canvas-terminal-node rounded-[14px] border overflow-hidden flex flex-col ${
          selected ? 'border-accent/40' : 'border-white/10'
        }`}
        style={{
          width: '100%',
          height: '100%',
          background: 'var(--color-terminal-bg, #171717)',
          boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.05), 0 4px 12px rgba(0, 0, 0, 0.15), 0 20px 40px rgba(0, 0, 0, 0.2)',
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
        <Handle id="top" type="source" position={Position.Top} className="!bg-transparent !border-none !w-0 !h-0" />
        <Handle id="top" type="target" position={Position.Top} className="!bg-transparent !border-none !w-0 !h-0" />
        <Handle
          id="bottom"
          type="source"
          position={Position.Bottom}
          className="!bg-transparent !border-none !w-0 !h-0"
        />
        <Handle
          id="bottom"
          type="target"
          position={Position.Bottom}
          className="!bg-transparent !border-none !w-0 !h-0"
        />
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
      <NodeMetadata ptyId={ptyId} />
    </>
  );
});

// ── Task name label above the card ──────────────────────────────────

const NodeTitle = memo(function NodeTitle({ ptyId }: { ptyId: string }) {
  const label = useTerminalStore((s) => s.displayStates[ptyId]?.label ?? '');
  const taskId = useTerminalStore((s) => s.displayStates[ptyId]?.taskId ?? null);

  if (!label) return null;

  return (
    <div className="px-1 pb-2" style={{ marginTop: -40 }}>
      <span className="inline-flex items-center gap-2 text-xl font-semibold text-white/80 truncate max-w-full">
        {taskId != null && <span className="text-white/30 font-mono text-base">T-{taskId}</span>}
        {label}
      </span>
    </div>
  );
});

// ── Peripheral metadata strip below the card ────────────────────────

const EMPTY_TAGS: string[] = [];

const NodeMetadata = memo(function NodeMetadata({ ptyId }: { ptyId: string }) {
  const taskId = useTerminalStore((s) => s.displayStates[ptyId]?.taskId ?? null);
  const worktreeBranch = useTerminalStore((s) => s.displayStates[ptyId]?.worktreeBranch ?? null);
  const tags = useTerminalStore((s) => s.displayStates[ptyId]?.tags) ?? EMPTY_TAGS;
  const summaryType = useTerminalStore((s) => s.displayStates[ptyId]?.summaryType ?? 'ready');
  const tasks = useProjectStore((s) => s.tasks);

  // Find the task for chain info
  const task = taskId != null ? tasks.find((t) => t.taskNumber === taskId) : null;
  const chainMap = taskId != null ? buildChainMap(tasks) : null;
  const chainInfo = taskId != null && chainMap ? chainMap.get(taskId) : null;
  const hasChain = isChainMember(chainInfo);

  const hasPills = taskId != null || worktreeBranch || tags.length > 0;
  if (!hasPills) return null;

  return (
    <div className="flex items-center gap-1.5 px-1 pt-2 pb-1 flex-wrap" style={{ maxWidth: '100%' }}>
      {/* Task number */}
      {taskId != null && (
        <Pill>
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{
              backgroundColor: summaryType === 'thinking' ? '#da77f2' : '#69db7c',
              boxShadow:
                summaryType === 'thinking' ? '0 0 4px rgba(218, 119, 242, 0.5)' : '0 0 4px rgba(105, 219, 124, 0.5)',
            }}
          />
          T-{taskId}
        </Pill>
      )}

      {/* Chain badge */}
      {hasChain && chainInfo && (
        <Pill
          style={{
            color: getChainColor(chainInfo.rootTaskNumber, chainInfo.depth),
            backgroundColor: getChainBgColor(chainInfo.rootTaskNumber, chainInfo.depth),
          }}
        >
          {chainInfo.depth === 0
            ? `root · ${chainInfo.childTaskNumbers.length} child${chainInfo.childTaskNumbers.length !== 1 ? 'ren' : ''}`
            : `depth ${chainInfo.depth}`}
        </Pill>
      )}

      {/* Branch */}
      {worktreeBranch && (
        <Pill>
          <Icon name="git-branch" className="!w-3 !h-3 text-white/40" />
          <span className="truncate max-w-[180px]">{worktreeBranch}</span>
        </Pill>
      )}

      {/* Tags */}
      {tags.map((tag) => (
        <Pill key={tag}>
          <Icon name="tag" className="!w-3 !h-3 text-white/30" />
          {tag}
        </Pill>
      ))}

      {/* Task description preview */}
      {task?.prompt && <span className="text-[11px] text-white/30 truncate max-w-[300px] ml-1">{task.prompt}</span>}
    </div>
  );
});

function Pill({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <span
      className="inline-flex items-center gap-1 font-mono text-[11px] text-white/50 bg-white/[0.06] rounded-full px-2 py-0.5 shrink-0"
      style={style}
    >
      {children}
    </span>
  );
}
