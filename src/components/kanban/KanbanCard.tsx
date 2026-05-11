import { memo, useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { useShallow } from 'zustand/react/shallow';
import type { TaskWithWorkspace } from '../../types';
import { useTerminalStore, type TerminalDisplayState } from '../../stores/terminalStore';
import { useProjectStore } from '../../stores/projectStore';
import { terminalInstances } from '../terminal/terminalReact';
import { Icon } from '../terminal/Icon';
import { ContextMenu, type ContextMenuEntry } from '../ui/ContextMenu';
import { HookConfigDialog } from '../dialogs/HookConfigDialog';
import { BranchFromTaskDialog } from '../dialogs/BranchFromTaskDialog';
import { Tooltip } from '../ui/Tooltip';
import type { TaskChainInfo } from '../../utils/taskChain';
import { isChainMember, isDescendantOf } from '../../utils/taskChain';
import { KanbanCardView } from './KanbanCardView';
import { KanbanBadgeView } from './KanbanBadgeView';

interface KanbanCardProps {
  task: TaskWithWorkspace;
  projectPath: string;
  chainInfo?: TaskChainInfo;
  chainMap?: Map<number, TaskChainInfo>;
  isSettingUp?: boolean;
  isSelected?: boolean;
  /** Hoisted from per-card IPC to a single board-level call. */
  sandboxAvailable?: boolean;
  /** Hoisted from per-card IPC to a single board-level call. */
  hasEditorHook?: boolean;
  /** Called after the user saves an editor hook from this card's dialog. */
  onEditorHookConfigured?: () => void;
  onRename: (taskNumber: number, newName: string) => void;
  onUpdateDescription: (taskNumber: number, description: string) => void;
  onOpenTerminal: (task: TaskWithWorkspace, sandboxed?: boolean) => void;
  onSwitchToTerminal: (ptyId: string) => void;
  onSelect: (taskNumber: number, event: React.MouseEvent) => void;
}

export const KanbanCard = memo(function KanbanCard({
  task,
  projectPath,
  chainInfo,
  chainMap,
  isSettingUp,
  isSelected,
  sandboxAvailable = false,
  hasEditorHook = false,
  onEditorHookConfigured,
  onRename,
  onUpdateDescription,
  onOpenTerminal,
  onSwitchToTerminal,
  onSelect,
}: KanbanCardProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [editorHookDialog, setEditorHookDialog] = useState(false);
  const [branchFromDialog, setBranchFromDialog] = useState(false);
  const [terminalContextMenu, setTerminalContextMenu] = useState<{ x: number; y: number; ptyId: string } | null>(null);
  const [renamingTerminalId, setRenamingTerminalId] = useState<string | null>(null);
  const [initialRenamingLabel, setInitialRenamingLabel] = useState<string>('');
  const [isRenamingTask, setIsRenamingTask] = useState(false);

  const isInChain = isChainMember(chainInfo);

  // Badge drag visual feedback — derive per-card booleans in selectors to avoid O(N) re-renders
  const activeBadgeDragSource = useProjectStore((s) => s.activeBadgeDrag);
  const isHoveredByBadgeDrag = useProjectStore((s) => s.badgeDragOverTask === task.taskNumber);
  const optionKeyHeld = useProjectStore((s) => s.optionKeyHeld);
  const isBadgeDragActive = activeBadgeDragSource != null;
  const isValidBadgeTarget = useMemo(() => {
    if (activeBadgeDragSource == null || activeBadgeDragSource === task.taskNumber || !chainMap) return false;
    return !isDescendantOf(task.taskNumber, activeBadgeDragSource, chainMap);
  }, [activeBadgeDragSource, task.taskNumber, chainMap]);
  const isHoveredBadgeTarget = isValidBadgeTarget && isHoveredByBadgeDrag;
  const isInvalidBadgeTarget = isBadgeDragActive && !isValidBadgeTarget;
  const showBadge = isInChain || optionKeyHeld;

  // Find connected terminals for this task — shallow compare avoids re-renders from unrelated terminal updates
  const connectedDisplays = useTerminalStore(
    useShallow((s) => {
      const ids = s.terminalsByProject[projectPath] ?? [];
      const result: TerminalDisplayState[] = [];
      for (const ptyId of ids) {
        const d = s.displayStates[ptyId];
        if (d?.taskId === task.taskNumber && !d.isLoading) result.push(d);
      }
      return result;
    }),
  );

  const formattedDate = task.createdAt
    ? new Date(task.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

  const handleCommitRenameTerminal = useCallback((ptyId: string, label: string) => {
    useTerminalStore.getState().updateDisplay(ptyId, { label });
    setRenamingTerminalId(null);
  }, []);

  const handleCancelRenameTerminal = useCallback(() => {
    setRenamingTerminalId(null);
  }, []);

  const startRenamingTerminal = useCallback((ptyId: string) => {
    const display = useTerminalStore.getState().displayStates[ptyId];
    setInitialRenamingLabel(display?.label ?? '');
    setRenamingTerminalId(ptyId);
  }, []);

  const handleCommitRenameTask = useCallback(
    (taskNumber: number, newName: string) => {
      onRename(taskNumber, newName);
      setIsRenamingTask(false);
    },
    [onRename],
  );

  const handleCancelRenameTask = useCallback(() => {
    setIsRenamingTask(false);
  }, []);

  const handleStartRenameTask = useCallback(() => {
    setIsRenamingTask(true);
  }, []);

  const handlePlainClick = useCallback(() => {
    if (useProjectStore.getState().selectedTaskNumbers.size > 0) {
      useProjectStore.getState().clearSelection();
    }
  }, []);

  const isDone = task.status === 'done';

  const terminalContextMenuItems = useMemo((): ContextMenuEntry[] => {
    if (!terminalContextMenu) return [];
    return [
      {
        label: 'Rename',
        icon: 'pencil-simple',
        onClick: () => startRenamingTerminal(terminalContextMenu.ptyId),
      },
    ];
  }, [terminalContextMenu, startRenamingTerminal]);

  const selectedCount = useProjectStore((s) => s.selectedTaskNumbers.size);
  const contextMenuItems = useMemo((): ContextMenuEntry[] => {
    if (isSelected && selectedCount > 1) {
      const items: ContextMenuEntry[] = [
        {
          label: 'Move to To Do',
          onClick: async () => {
            const selected = [...useProjectStore.getState().selectedTaskNumbers];
            await Promise.allSettled(selected.map((n) => window.api.task.setStatus(projectPath, n, 'todo')));
            useProjectStore.getState().loadTasks(projectPath);
            useProjectStore.getState().clearSelection();
            useProjectStore.getState().addToast(`Moved ${selected.length} tasks to To Do`, 'success');
          },
        },
        {
          label: 'Move to In Progress',
          onClick: async () => {
            const selected = [...useProjectStore.getState().selectedTaskNumbers];
            await Promise.allSettled(selected.map((n) => window.api.task.setStatus(projectPath, n, 'in_progress')));
            useProjectStore.getState().loadTasks(projectPath);
            useProjectStore.getState().clearSelection();
            useProjectStore.getState().addToast(`Moved ${selected.length} tasks to In Progress`, 'success');
          },
        },
        {
          label: 'Move to In Review',
          onClick: async () => {
            const selected = [...useProjectStore.getState().selectedTaskNumbers];
            await Promise.allSettled(selected.map((n) => window.api.task.setStatus(projectPath, n, 'in_review')));
            useProjectStore.getState().loadTasks(projectPath);
            useProjectStore.getState().clearSelection();
            useProjectStore.getState().addToast(`Moved ${selected.length} tasks to In Review`, 'success');
          },
        },
        {
          label: 'Move to Done',
          onClick: async () => {
            const selected = [...useProjectStore.getState().selectedTaskNumbers];
            await Promise.allSettled(selected.map((n) => window.api.task.setStatus(projectPath, n, 'done')));
            useProjectStore.getState().loadTasks(projectPath);
            useProjectStore.getState().clearSelection();
            useProjectStore.getState().addToast(`Moved ${selected.length} tasks to Done`, 'success');
          },
        },
        { separator: true },
        {
          label: 'Open in Terminal',
          icon: 'terminal',
          onClick: () => {
            const store = useProjectStore.getState();
            const selected = [...store.selectedTaskNumbers];
            const tasks = store.tasks.filter((t) => selected.includes(t.taskNumber));
            for (const t of tasks) onOpenTerminal(t);
            store.clearSelection();
          },
        },
        { separator: true },
        {
          label: 'Delete',
          icon: 'trash',
          danger: true,
          onClick: async () => {
            const selected = [...useProjectStore.getState().selectedTaskNumbers];
            await Promise.allSettled(selected.map((n) => window.api.task.trash(projectPath, n)));
            useProjectStore.getState().loadTasks(projectPath);
            useProjectStore.getState().clearSelection();
            useProjectStore.getState().addToast(`Deleted ${selected.length} tasks`, 'success');
          },
        },
      ];
      return items;
    }

    const items: ContextMenuEntry[] = [];

    for (const display of connectedDisplays) {
      items.push({
        label: display.lastOscTitle || display.label || 'Shell',
        onClick: () => onSwitchToTerminal(display.ptyId),
      });
    }
    if (connectedDisplays.length > 0) {
      items.push({ separator: true });
    }

    items.push({
      label: 'Open in Terminal',
      icon: 'terminal',
      onClick: () => onOpenTerminal(task),
    });

    if (task.worktreePath && task.branch && sandboxAvailable) {
      items.push({
        label: 'Open in Sandbox',
        icon: 'cube',
        onClick: () => onOpenTerminal(task, true),
      });
    }

    items.push({
      label: 'Open in Editor',
      icon: 'code',
      onClick: () => {
        if (hasEditorHook && task.worktreePath) {
          window.api.openInEditor(projectPath, task.worktreePath);
        } else {
          setEditorHookDialog(true);
        }
      },
    });

    const planDisplay = connectedDisplays.find((d) => d.planPath);
    if (planDisplay) {
      items.push({
        label: 'View Plan',
        icon: 'list-checks',
        onClick: () => {
          onSwitchToTerminal(planDisplay.ptyId);
          const inst = terminalInstances.get(planDisplay.ptyId);
          if (inst && !inst.planPanelOpen) {
            inst.planPanelOpen = true;
            inst.diffPanelOpen = false;
            inst.runnerPanelOpen = false;
            inst.pushDisplayState({ planPanelOpen: true, diffPanelOpen: false, runnerPanelOpen: false });
          }
        },
      });
    }

    items.push({ separator: true });

    if (task.branch && task.status !== 'done') {
      items.push({
        label: 'Branch from this task',
        icon: 'git-branch',
        onClick: () => setBranchFromDialog(true),
      });
    }

    items.push({
      label: 'Rename',
      icon: 'pencil-simple',
      onClick: handleStartRenameTask,
    });

    if (isDone) {
      items.push({
        label: 'Reopen',
        icon: 'arrow-counter-clockwise',
        onClick: async () => {
          await window.api.task.setStatus(projectPath, task.taskNumber, 'in_progress');
          useProjectStore.getState().loadTasks(projectPath);
        },
      });
    } else {
      items.push({
        label: 'Move to Done',
        icon: 'archive',
        onClick: async () => {
          await window.api.task.setStatus(projectPath, task.taskNumber, 'done');
          useProjectStore.getState().loadTasks(projectPath);
        },
      });
    }

    items.push({
      label: 'Delete',
      icon: 'trash',
      danger: true,
      onClick: async () => {
        await window.api.task.trash(projectPath, task.taskNumber);
        useProjectStore.getState().loadTasks(projectPath);
        useProjectStore.getState().addToast('Task deleted', 'success');
      },
    });

    return items;
  }, [
    connectedDisplays,
    task,
    projectPath,
    isDone,
    sandboxAvailable,
    hasEditorHook,
    isSelected,
    selectedCount,
    onSwitchToTerminal,
    onOpenTerminal,
    handleStartRenameTask,
  ]);

  return (
    <>
      <KanbanCardView
        task={task}
        connectedDisplays={connectedDisplays}
        isSettingUp={isSettingUp}
        isSelected={isSelected}
        isHoveredBadgeTarget={isHoveredBadgeTarget}
        isValidBadgeTarget={isValidBadgeTarget}
        isInvalidBadgeTarget={isInvalidBadgeTarget}
        showBadge={showBadge}
        badge={
          showBadge ? (
            <DraggableBadge task={task} projectPath={projectPath} chainInfo={chainInfo} chainMap={chainMap} />
          ) : null
        }
        formattedDate={formattedDate}
        onSelect={onSelect}
        onPlainClick={handlePlainClick}
        onContextMenu={(e) => setContextMenu({ x: e.clientX, y: e.clientY })}
        onUpdateDescription={onUpdateDescription}
        onSwitchToTerminal={onSwitchToTerminal}
        onTerminalContextMenu={(ptyId, e) => setTerminalContextMenu({ x: e.clientX, y: e.clientY, ptyId })}
        isRenamingTask={isRenamingTask}
        onStartRenameTask={handleStartRenameTask}
        onCommitRenameTask={handleCommitRenameTask}
        onCancelRenameTask={handleCancelRenameTask}
        renamingTerminalId={renamingTerminalId}
        initialRenamingLabel={initialRenamingLabel}
        onCommitRenameTerminal={handleCommitRenameTerminal}
        onCancelRenameTerminal={handleCancelRenameTerminal}
      />
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
      {terminalContextMenu && (
        <ContextMenu
          x={terminalContextMenu.x}
          y={terminalContextMenu.y}
          items={terminalContextMenuItems}
          onClose={() => setTerminalContextMenu(null)}
        />
      )}
      {editorHookDialog && (
        <HookConfigDialog
          projectPath={projectPath}
          hookType="editor"
          onClose={(result) => {
            setEditorHookDialog(false);
            if (result?.saved) onEditorHookConfigured?.();
          }}
        />
      )}
      {branchFromDialog && (
        <BranchFromTaskDialog
          projectPath={projectPath}
          parentTask={task}
          onClose={(created) => {
            setBranchFromDialog(false);
            if (created) {
              useProjectStore.getState().loadTasks(projectPath);
            }
          }}
        />
      )}
    </>
  );
});

// ── Draggable badge with × unlink ───────────────────────────────────

function DraggableBadge({
  task,
  projectPath,
  chainInfo,
  chainMap,
}: {
  task: TaskWithWorkspace;
  projectPath: string;
  chainInfo?: TaskChainInfo;
  chainMap?: Map<number, TaskChainInfo>;
}) {
  const isInChain = isChainMember(chainInfo);

  const highlightedChainTask = useProjectStore((s) => s.highlightedChainTask);
  const hoveredChainRoot = highlightedChainTask != null ? chainMap?.get(highlightedChainTask)?.rootTaskNumber : null;
  const shouldJitter =
    isInChain &&
    chainInfo != null &&
    hoveredChainRoot != null &&
    hoveredChainRoot === chainInfo.rootTaskNumber &&
    highlightedChainTask !== task.taskNumber;

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `badge-${task.taskNumber}`,
    data: { type: 'badge', taskNumber: task.taskNumber },
  });

  const [detachHovered, setDetachHovered] = useState(false);
  const detachingRef = useRef(false);
  const detachHoverParent = useProjectStore((s) => s.detachHoverParent);
  const isDimmedByDetach = detachHoverParent === task.taskNumber;

  useEffect(() => {
    return () => {
      if (useProjectStore.getState().detachHoverParent != null) {
        useProjectStore.getState().setDetachHoverParent(null);
      }
    };
  }, []);

  const tooltipContent: ReactNode =
    isInChain && chainInfo ? (
      <div className="flex flex-col gap-0.5">
        {task.parentTaskNumber != null && (
          <span>
            Branches from <span className="opacity-50">#</span>
            {task.parentTaskNumber}
          </span>
        )}
        {chainInfo.childTaskNumbers.length > 0 && (
          <span>
            Parent of{' '}
            {chainInfo.childTaskNumbers.map((n, i) => (
              <span key={n}>
                {i > 0 && ', '}
                <span className="opacity-50">#</span>
                {n}
              </span>
            ))}
          </span>
        )}
      </div>
    ) : (
      <span>
        Task <span className="opacity-50">#</span>
        {task.taskNumber}
      </span>
    );

  const detachButton =
    task.parentTaskNumber != null ? (
      <Tooltip text={`Detach from #${task.parentTaskNumber}`} placement="bottom" delay={300}>
        <button
          className="w-0 overflow-hidden group-hover/badge:w-4 flex items-center justify-center border-none bg-transparent text-white/30 hover:text-red-400 transition-all duration-150 [-webkit-app-region:no-drag] [&>svg]:w-2.5 [&>svg]:h-2.5 shrink-0 p-0"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={async (e) => {
            e.stopPropagation();
            if (detachingRef.current) return;
            detachingRef.current = true;
            try {
              setDetachHovered(false);
              useProjectStore.getState().clearChainHighlights();
              const mainBranch = await window.api.worktree.getMainBranch(projectPath);
              await window.api.task.setParent(projectPath, task.taskNumber, null, mainBranch);
              useProjectStore.getState().loadTasks(projectPath);
            } finally {
              detachingRef.current = false;
            }
          }}
          onMouseEnter={() => {
            setDetachHovered(true);
            if (task.parentTaskNumber != null) {
              useProjectStore.getState().setDetachHoverParent(task.parentTaskNumber);
            }
          }}
          onMouseLeave={() => {
            setDetachHovered(false);
            useProjectStore.getState().setDetachHoverParent(null);
          }}
        >
          <Icon name="x" />
        </button>
      </Tooltip>
    ) : undefined;

  return (
    <Tooltip
      text={tooltipContent}
      placement="bottom"
      disabled={isDragging || detachHovered}
      referenceClassName="inline-flex"
      onHoverChange={
        isInChain
          ? (hovering) => useProjectStore.getState().setHighlightedChainTask(hovering ? task.taskNumber : null)
          : undefined
      }
    >
      <KanbanBadgeView
        taskNumber={task.taskNumber}
        chainInfo={chainInfo}
        isDragging={isDragging}
        isDimmed={isDimmedByDetach}
        shouldJitter={shouldJitter}
        dragHandleProps={{ ref: setNodeRef, ...listeners, ...attributes }}
        detachButton={detachButton}
      />
    </Tooltip>
  );
}
