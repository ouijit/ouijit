import { memo, useCallback } from 'react';
import { NodeResizer, Handle, Position, type NodeProps } from '@xyflow/react';
import type { TerminalNode as TerminalNodeType } from '../../stores/canvasStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTerminalPanels } from '../terminal/useTerminalPanels';
import { closeProjectTerminal } from '../terminal/terminalActions';
import { TerminalBody } from '../terminal/TerminalBody';
import { Icon } from '../terminal/Icon';
import { buildChainMap, getChainColor, getChainBgColor, isChainMember } from '../../utils/taskChain';

const INSET_TOP = 68;
const INSET_SIDE = 10;
const INSET_BOTTOM = 8;

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

  const bodyClasses = selected ? 'nodrag nowheel nopan flex flex-col flex-1 min-h-0' : 'flex flex-col flex-1 min-h-0';

  return (
    <>
      <NodeResizer
        minWidth={400}
        minHeight={200}
        maxWidth={2400}
        maxHeight={1600}
        isVisible={!!selected}
        lineClassName="!border-accent/30"
        handleClassName="!w-2.5 !h-2.5 !bg-accent/60 !border-accent/80 !rounded-none"
      />
      <Handle id="top" type="source" position={Position.Top} className="!bg-transparent !border-none !w-0 !h-0" />
      <Handle id="top" type="target" position={Position.Top} className="!bg-transparent !border-none !w-0 !h-0" />
      <Handle id="bottom" type="source" position={Position.Bottom} className="!bg-transparent !border-none !w-0 !h-0" />
      <Handle id="bottom" type="target" position={Position.Bottom} className="!bg-transparent !border-none !w-0 !h-0" />
      <Handle id="left" type="source" position={Position.Left} className="!bg-transparent !border-none !w-0 !h-0" />
      <Handle id="left" type="target" position={Position.Left} className="!bg-transparent !border-none !w-0 !h-0" />
      <Handle id="right" type="source" position={Position.Right} className="!bg-transparent !border-none !w-0 !h-0" />
      <Handle id="right" type="target" position={Position.Right} className="!bg-transparent !border-none !w-0 !h-0" />

      {/* ── Periphery above card ────────────────────────────────── */}
      <div className="terminal-drag-handle absolute px-1" style={{ top: 2, left: INSET_SIDE, right: INSET_SIDE }}>
        <NodePeriphery
          ptyId={ptyId}
          onClose={handleClose}
          onToggleDiffPanel={toggleDiffPanel}
          onTogglePlanPanel={togglePlanPanel}
          onToggleRunner={toggleRunner}
        />
      </div>

      {/* ── Card: terminal only ──────────────────────────────────── */}
      <div
        className="canvas-terminal-node absolute rounded-[14px] border border-white/10 overflow-hidden flex flex-col"
        style={{
          top: INSET_TOP,
          left: INSET_SIDE,
          right: INSET_SIDE,
          bottom: INSET_BOTTOM,
          background: 'var(--color-terminal-bg, #171717)',
          boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.05), 0 4px 12px rgba(0, 0, 0, 0.15), 0 20px 40px rgba(0, 0, 0, 0.2)',
        }}
      >
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
    </>
  );
});

// ── Periphery: single row matching TerminalHeader layout ────────────

const EMPTY_TAGS: string[] = [];

interface PeripheryProps {
  ptyId: string;
  onClose: () => void;
  onToggleDiffPanel: () => void;
  onTogglePlanPanel: () => void;
  onToggleRunner: () => void;
}

const NodePeriphery = memo(function NodePeriphery({
  ptyId,
  onClose,
  onToggleDiffPanel,
  onTogglePlanPanel,
  onToggleRunner,
}: PeripheryProps) {
  const label = useTerminalStore((s) => s.displayStates[ptyId]?.label ?? '');
  const summary = useTerminalStore((s) => s.displayStates[ptyId]?.summary ?? '');
  const summaryType = useTerminalStore((s) => s.displayStates[ptyId]?.summaryType ?? 'ready');
  const taskId = useTerminalStore((s) => s.displayStates[ptyId]?.taskId ?? null);
  const gitFileStatus = useTerminalStore((s) => s.displayStates[ptyId]?.gitFileStatus ?? null);
  const tags = useTerminalStore((s) => s.displayStates[ptyId]?.tags) ?? EMPTY_TAGS;
  const runnerStatus = useTerminalStore((s) => s.displayStates[ptyId]?.runnerStatus ?? 'idle');
  const runnerScriptName = useTerminalStore((s) => s.displayStates[ptyId]?.runnerScriptName ?? null);
  const runnerPanelOpen = useTerminalStore((s) => s.displayStates[ptyId]?.runnerPanelOpen ?? false);
  const diffPanelOpen = useTerminalStore((s) => s.displayStates[ptyId]?.diffPanelOpen ?? false);
  const planPath = useTerminalStore((s) => s.displayStates[ptyId]?.planPath ?? null);
  const planPanelOpen = useTerminalStore((s) => s.displayStates[ptyId]?.planPanelOpen ?? false);
  const worktreeBranch = useTerminalStore((s) => s.displayStates[ptyId]?.worktreeBranch ?? null);
  const tasks = useProjectStore((s) => s.tasks);

  const isWorktree = taskId != null && !!worktreeBranch;
  const dirtyFileCount = gitFileStatus?.uncommittedFiles.length ?? 0;
  const branchDiffCount = gitFileStatus?.branchDiffFiles.length ?? 0;
  const showDiff = dirtyFileCount > 0 || (isWorktree && branchDiffCount > 0);

  const chainMap = taskId != null ? buildChainMap(tasks) : null;
  const chainInfo = taskId != null && chainMap ? chainMap.get(taskId) : null;
  const hasChain = isChainMember(chainInfo);

  // Runner text + color
  let runText = 'Run';
  if (runnerStatus === 'running') runText = runnerScriptName ?? 'Running';
  else if (runnerStatus === 'success') runText = 'Done';
  else if (runnerStatus === 'error') runText = 'Failed';

  const runColors =
    runnerStatus === 'running' || runnerStatus === 'success'
      ? 'text-[#69db7c]'
      : runnerStatus === 'error'
        ? 'text-[#ff6b6b]'
        : 'text-white/60';

  // Display text: label — summary (matching TerminalHeader pattern)
  const displayText = summary ? `${label} \u2014 ${summary}` : label || 'Shell';

  return (
    <div className="flex flex-col gap-0.5 py-1 min-w-0">
      {/* Top row: status + label + actions */}
      <div className="flex items-center justify-between min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`w-3.5 h-3.5 rounded-full shrink-0 transition-all duration-200 ease-out ${summaryType === 'thinking' ? 'bg-[#da77f2]' : 'bg-[#69db7c]'}`}
            data-status={summaryType}
            style={{
              boxShadow:
                summaryType === 'thinking' ? '0 0 4px rgba(218, 119, 242, 0.5)' : '0 0 4px rgba(105, 219, 124, 0.5)',
              ...(summaryType === 'thinking' ? { animation: 'terminal-status-pulse 1s ease-in-out infinite' } : {}),
            }}
          />
          <span className="font-mono text-lg font-medium text-white/80 truncate min-w-0">{displayText}</span>
        </div>

        {/* Right: action buttons */}
        <div className="flex items-center gap-2 shrink-0 ml-3 nodrag">
          {planPath && (
            <button
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full font-mono text-[13px] font-medium text-white/60 bg-white/[0.06] border-none transition-all duration-150 ease-out hover:bg-white/[0.12] hover:text-white/90 ${planPanelOpen ? '!bg-accent !text-white' : ''}`}
              title="View plan"
              onClick={(e) => {
                e.stopPropagation();
                onTogglePlanPanel();
              }}
            >
              <Icon name="list-checks" className="w-3.5 h-3.5" />
              <span>Plan</span>
            </button>
          )}
          {showDiff && (
            <button
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full font-mono text-[13px] font-medium text-white/60 bg-white/[0.06] border-none transition-all duration-150 ease-out hover:bg-white/[0.12] hover:text-white/90 ${diffPanelOpen ? '!bg-accent !text-white' : ''}`}
              title="View changes"
              onClick={(e) => {
                e.stopPropagation();
                onToggleDiffPanel();
              }}
            >
              <span className="font-medium">
                {dirtyFileCount > 0 ? `${dirtyFileCount} file${dirtyFileCount !== 1 ? 's' : ''}` : 'Compare'}
              </span>
            </button>
          )}
          <button
            className={`px-2.5 py-1 bg-white/[0.06] border-none font-sans text-[13px] font-medium rounded-full transition-all duration-150 ease-out hover:bg-white/[0.12] hover:text-white/90 ${runnerPanelOpen ? '!bg-accent !text-white' : runColors}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleRunner();
            }}
          >
            {runText}
          </button>
          <button
            className="w-7 h-7 flex items-center justify-center bg-transparent border-none text-white/40 hover:text-white/90 transition-colors duration-150 ml-1 [&_svg]:w-4 [&_svg]:h-4"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
          >
            <Icon name="x" />
          </button>
        </div>
      </div>
      {/* Bottom row: branch + pills */}
      <div className="flex items-center gap-1.5 min-w-0 pl-[22px]">
        {(worktreeBranch || gitFileStatus?.branch) && (
          <span className="inline-flex items-center gap-1 font-mono text-[13px] text-white/50 min-w-0 overflow-hidden">
            <Icon name="git-branch" className="w-3.5 h-3.5 shrink-0 text-white/40" />
            <span className="truncate min-w-0">{worktreeBranch || gitFileStatus?.branch}</span>
          </span>
        )}
        {hasChain && chainInfo && (
          <span
            className="inline-flex items-center gap-1 font-mono text-[11px] rounded-full px-2 py-px shrink-0"
            style={{
              color: getChainColor(chainInfo.rootTaskNumber, chainInfo.depth),
              backgroundColor: getChainBgColor(chainInfo.rootTaskNumber, chainInfo.depth),
            }}
          >
            {chainInfo.depth === 0
              ? `root \u00b7 ${chainInfo.childTaskNumbers.length} child${chainInfo.childTaskNumbers.length !== 1 ? 'ren' : ''}`
              : `depth ${chainInfo.depth}`}
          </span>
        )}
        {tags.map((tag) => (
          <span
            key={tag}
            className="font-mono text-[11px] text-white/50 bg-white/[0.06] rounded-full px-2 py-px shrink-0"
          >
            {tag}
          </span>
        ))}
      </div>
    </div>
  );
});
