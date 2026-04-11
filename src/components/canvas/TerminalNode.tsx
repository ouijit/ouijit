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

  const bodyClasses = selected ? 'nodrag nowheel nopan flex-1 min-h-0' : 'flex-1 min-h-0';

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

      {/* ── Periphery above card: title + pills + actions ────────── */}
      <div
        className="terminal-drag-handle absolute flex flex-col gap-1 px-1"
        style={{ top: 2, left: INSET_SIDE, right: INSET_SIDE }}
      >
        <NodeTitleRow
          ptyId={ptyId}
          onClose={handleClose}
          onToggleDiffPanel={toggleDiffPanel}
          onTogglePlanPanel={togglePlanPanel}
          onToggleRunner={toggleRunner}
        />
        <NodeInfoRow ptyId={ptyId} />
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

// ── Title row: label + action buttons ───────────────────────────────

interface TitleRowProps {
  ptyId: string;
  onClose: () => void;
  onToggleDiffPanel: () => void;
  onTogglePlanPanel: () => void;
  onToggleRunner: () => void;
}

const NodeTitleRow = memo(function NodeTitleRow({
  ptyId,
  onClose,
  onToggleDiffPanel,
  onTogglePlanPanel,
  onToggleRunner,
}: TitleRowProps) {
  const label = useTerminalStore((s) => s.displayStates[ptyId]?.label ?? '');
  const taskId = useTerminalStore((s) => s.displayStates[ptyId]?.taskId ?? null);
  const planPath = useTerminalStore((s) => s.displayStates[ptyId]?.planPath ?? null);
  const planPanelOpen = useTerminalStore((s) => s.displayStates[ptyId]?.planPanelOpen ?? false);
  const diffPanelOpen = useTerminalStore((s) => s.displayStates[ptyId]?.diffPanelOpen ?? false);
  const gitFileStatus = useTerminalStore((s) => s.displayStates[ptyId]?.gitFileStatus ?? null);
  const runnerStatus = useTerminalStore((s) => s.displayStates[ptyId]?.runnerStatus ?? 'idle');
  const runnerScriptName = useTerminalStore((s) => s.displayStates[ptyId]?.runnerScriptName ?? null);
  const runnerPanelOpen = useTerminalStore((s) => s.displayStates[ptyId]?.runnerPanelOpen ?? false);
  const worktreeBranch = useTerminalStore((s) => s.displayStates[ptyId]?.worktreeBranch ?? null);
  const isWorktree = taskId != null && !!worktreeBranch;

  const dirtyFileCount = gitFileStatus?.uncommittedFiles.length ?? 0;
  const branchDiffCount = gitFileStatus?.branchDiffFiles.length ?? 0;
  const showDiff = dirtyFileCount > 0 || (isWorktree && branchDiffCount > 0);

  let runText = 'Run';
  if (runnerStatus === 'running') runText = runnerScriptName ?? 'Running';
  else if (runnerStatus === 'success') runText = 'Done';
  else if (runnerStatus === 'error') runText = 'Failed';

  const runColors =
    runnerStatus === 'running' || runnerStatus === 'success'
      ? 'text-[#69db7c]'
      : runnerStatus === 'error'
        ? 'text-[#ff6b6b]'
        : 'text-white/50';

  return (
    <div className="flex items-center justify-between min-w-0">
      <span className="inline-flex items-center gap-2 text-lg font-semibold text-white/80 truncate min-w-0">
        {taskId != null && <span className="text-white/30 font-mono text-sm">T-{taskId}</span>}
        {label || 'Shell'}
      </span>
      <div className="flex items-center gap-1.5 shrink-0 ml-3 nodrag">
        {planPath && (
          <ActionBtn active={planPanelOpen} onClick={onTogglePlanPanel} title="Plan">
            <Icon name="list-checks" className="w-3 h-3" />
          </ActionBtn>
        )}
        {showDiff && (
          <ActionBtn
            active={diffPanelOpen}
            onClick={onToggleDiffPanel}
            title={dirtyFileCount > 0 ? `${dirtyFileCount} files` : 'Compare'}
          >
            <span className="text-[11px] font-mono">{dirtyFileCount > 0 ? dirtyFileCount : '~'}</span>
          </ActionBtn>
        )}
        <ActionBtn active={runnerPanelOpen} onClick={onToggleRunner} title={runText} className={runColors}>
          <span className="text-[11px] font-medium">{runText}</span>
        </ActionBtn>
        <button
          className="w-6 h-6 flex items-center justify-center bg-transparent border-none text-white/30 hover:text-white/70 transition-colors duration-150"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          <Icon name="x" className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
});

function ActionBtn({
  children,
  active,
  onClick,
  title,
  className,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick: () => void;
  title: string;
  className?: string;
}) {
  return (
    <button
      className={`flex items-center gap-1 px-2 py-0.5 rounded-full font-mono text-[11px] bg-white/[0.06] border-none transition-colors duration-150 hover:bg-white/[0.12] ${active ? '!bg-accent !text-white' : (className ?? 'text-white/50')}`}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

// ── Info row: status + pills ────────────────────────────────────────

const EMPTY_TAGS: string[] = [];

const NodeInfoRow = memo(function NodeInfoRow({ ptyId }: { ptyId: string }) {
  const summaryType = useTerminalStore((s) => s.displayStates[ptyId]?.summaryType ?? 'ready');
  const summary = useTerminalStore((s) => s.displayStates[ptyId]?.summary ?? '');
  const taskId = useTerminalStore((s) => s.displayStates[ptyId]?.taskId ?? null);
  const worktreeBranch = useTerminalStore((s) => s.displayStates[ptyId]?.worktreeBranch ?? null);
  const tags = useTerminalStore((s) => s.displayStates[ptyId]?.tags) ?? EMPTY_TAGS;
  const tasks = useProjectStore((s) => s.tasks);

  const chainMap = taskId != null ? buildChainMap(tasks) : null;
  const chainInfo = taskId != null && chainMap ? chainMap.get(taskId) : null;
  const hasChain = isChainMember(chainInfo);

  return (
    <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
      <span
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${summaryType === 'thinking' ? 'bg-[#da77f2]' : 'bg-[#69db7c]'}`}
        style={{
          boxShadow:
            summaryType === 'thinking' ? '0 0 4px rgba(218, 119, 242, 0.5)' : '0 0 4px rgba(105, 219, 124, 0.5)',
          ...(summaryType === 'thinking' ? { animation: 'terminal-status-pulse 1s ease-in-out infinite' } : {}),
        }}
      />
      {summary && <span className="font-mono text-[11px] text-white/40 truncate max-w-[200px]">{summary}</span>}
      {worktreeBranch && (
        <Pill>
          <Icon name="git-branch" className="!w-3 !h-3 text-white/40" />
          <span className="truncate max-w-[160px]">{worktreeBranch}</span>
        </Pill>
      )}
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
      {tags.map((tag) => (
        <Pill key={tag}>
          <Icon name="tag" className="!w-3 !h-3 text-white/30" />
          {tag}
        </Pill>
      ))}
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
