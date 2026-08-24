import { useEffect, useCallback, useState, useMemo, useRef, forwardRef } from 'react';
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  rectIntersection,
  useDroppable,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
  type CollisionDetection,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { useProjectStore } from '../../stores/projectStore';
import type { TaskWithWorkspace, TaskStatus, HookType, SandboxProviderId } from '../../types';
import { beginTransition, bulkTransitionTasks } from '../../services/taskStartService';
import { completeTask } from '../../services/taskCompletion';
import { KanbanColumn } from './KanbanColumn';
import { BulkActionBar } from './BulkActionBar';
import { OnboardingPanel } from './OnboardingPanel';
import { KanbanShellBar } from './KanbanShellBar';
import { focusKanbanAddInput } from './KanbanAddInput';
import { STATUS_LABELS } from './taskMenu';
import { useAppStore } from '../../stores/appStore';
import { HookConfigDialog } from '../dialogs/HookConfigDialog';
import { CombinedHookConfigDialog } from '../dialogs/CombinedHookConfigDialog';
import { MissingWorktreeDialog } from '../dialogs/MissingWorktreeDialog';
import { Icon } from '../terminal/Icon';
import { buildChainMap, isDescendantOf } from '../../utils/taskChain';
import { focusTerminal, openTaskShell } from '../navigation';
import log from 'electron-log/renderer';

const kanbanLog = log.scope('kanban');

const COLUMN_ORDER: TaskStatus[] = ['todo', 'in_progress', 'in_review', 'done'];
const COLUMNS: { status: TaskStatus; label: string }[] = COLUMN_ORDER.map((status) => ({
  status,
  label: STATUS_LABELS[status],
}));

const COLUMN_IDS: Set<string> = new Set(COLUMNS.map((c) => c.status));
const TRASH_ID = 'trash-zone';

const isMac = navigator.platform.toLowerCase().includes('mac');

/**
 * pointerWithin first, which handles empty containers; rectIntersection as a
 * fallback, which handles sortable items inside columns.
 */
const customCollision: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) {
    // Prioritise trash zone so it always wins when the pointer is inside it
    const trash = pointerCollisions.find((c) => c.id === TRASH_ID);
    if (trash) return [trash];
    return pointerCollisions;
  }
  return rectIntersection(args);
};

interface KanbanBoardProps {
  projectPath: string;
  onHide: () => void;
}

export function KanbanBoard({ projectPath, onHide }: KanbanBoardProps) {
  const storeTasks = useProjectStore((s) => s.tasks);
  const startingTaskNumbers = useProjectStore((s) => s.startingTaskNumbers);
  const [activeTask, setActiveTask] = useState<TaskWithWorkspace | null>(null);
  const activeBadgeDrag = useProjectStore((s) => s.activeBadgeDrag);
  // Project-scoped config is loaded once by ProjectViewReact; we just subscribe.
  const configuredHooks = useProjectStore((s) => s.configuredHooks);
  const availableSandboxProviders = useProjectStore((s) => s.availableSandboxProviders);
  const [hookDialog, setHookDialog] = useState<
    | { mode: 'single'; hookType: HookType; existingHook?: any }
    | { mode: 'combined'; start?: any; continue?: any }
    | null
  >(null);
  const [missingWorktreeDialog, setMissingWorktreeDialog] = useState<{
    task: TaskWithWorkspace;
    branchExists: boolean;
    resolve: (action: 'recover' | null) => void;
  } | null>(null);

  /**
   * Prompts to recover the worktree when it is missing from disk. Returns the
   * (possibly new) path, or null if cancelled or failed.
   */
  const ensureWorktreeExists = useCallback(
    async (task: TaskWithWorkspace): Promise<string | null> => {
      const check = await window.api.task.checkWorktree(projectPath, task.taskNumber);
      if (check.exists && task.worktreePath) return task.worktreePath;

      kanbanLog.warn('worktree missing', { taskNumber: task.taskNumber, branchExists: check.branchExists });

      const action = await new Promise<'recover' | null>((resolve) => {
        setMissingWorktreeDialog({ task, branchExists: check.branchExists, resolve });
      });
      setMissingWorktreeDialog(null);

      if (action !== 'recover') {
        kanbanLog.info('user cancelled worktree recovery', { taskNumber: task.taskNumber });
        return null;
      }

      const result = await window.api.task.recover(projectPath, task.taskNumber);
      if (!result.success || !result.worktreePath) {
        kanbanLog.error('worktree recovery failed', {
          taskNumber: task.taskNumber,
          error: result.error,
        });
        useProjectStore.getState().addToast(result.error || 'Failed to recover worktree', 'error');
        return null;
      }

      kanbanLog.info('worktree recovered', { taskNumber: task.taskNumber, worktreePath: result.worktreePath });
      if (result.task?.branch) task.branch = result.task.branch;
      task.worktreePath = result.worktreePath;
      useProjectStore.getState().loadTasks(projectPath);
      return result.worktreePath;
    },
    [projectPath],
  );

  // projectStore owns the config: loaded per project by ProjectViewReact and
  // refreshed by HookList and this board's hook-dialog close handler.
  const markEditorHookConfigured = useCallback(() => {
    useProjectStore.getState().markHookConfigured('editor');
  }, []);

  // Local task state for drag preview — synced from store, mutated during drag.
  // `storeTasks` gets a new identity on every task edit, so chainMap is keyed on
  // a fingerprint of the parent relations it actually depends on; otherwise
  // every rename re-renders every memoized card.
  const chainFingerprint = useMemo(
    () =>
      storeTasks
        .map((t) => `${t.taskNumber}:${t.parentTaskNumber ?? ''}`)
        .sort()
        .join('|'),
    [storeTasks],
  );
  const chainMap = useMemo(
    () => buildChainMap(storeTasks),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: rebuild only when parent relations change
    [chainFingerprint],
  );
  const [items, setItems] = useState<Record<string, TaskWithWorkspace[]>>({});
  const originalStatusRef = useRef<TaskStatus | null>(null);

  useEffect(() => {
    if (activeTask) return; // Don't clobber during drag
    const grouped: Record<string, TaskWithWorkspace[]> = {};
    for (const col of COLUMNS) grouped[col.status] = [];
    for (const task of storeTasks) {
      if (grouped[task.status]) grouped[task.status].push(task);
    }
    for (const status of Object.keys(grouped)) {
      grouped[status].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    }
    setItems(grouped);
  }, [storeTasks, activeTask]);

  useEffect(() => {
    useProjectStore.getState().loadTasks(projectPath);
  }, [projectPath]);

  // Hotkeys
  const runHookActive = useProjectStore((s) => s.runHookQueue.length > 0);
  const composerSheetOpen = useAppStore((s) => s.composerSheetCount > 0);
  const hasOpenDialog = !!(runHookActive || hookDialog || missingWorktreeDialog || composerSheetOpen);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (hasOpenDialog) return; // Let the dialog handle Escape
        const { selectedTaskNumbers, clearSelection } = useProjectStore.getState();
        if (selectedTaskNumbers.size > 0) {
          e.preventDefault();
          clearSelection();
        }
        // Otherwise let Escape fall through — board/stack toggling is owned by
        // Cmd/Ctrl+T, never Escape, so it doesn't fight with form-level resets.
        return;
      }
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        focusKanbanAddInput();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [hasOpenDialog]);

  // Track Option/Alt (for standalone badge display) and Shift (for done-hook
  // skip on drag-to-done) keys. Both are reset on blur so an external focus
  // change doesn't leave the modifier latched.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const state = useProjectStore.getState();
      if (state.optionKeyHeld !== e.altKey) useProjectStore.setState({ optionKeyHeld: e.altKey });
      if (state.shiftKeyHeld !== e.shiftKey) useProjectStore.setState({ shiftKeyHeld: e.shiftKey });
    };
    const onBlur = () => {
      const state = useProjectStore.getState();
      if (state.optionKeyHeld) useProjectStore.setState({ optionKeyHeld: false });
      if (state.shiftKeyHeld) useProjectStore.setState({ shiftKeyHeld: false });
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', onBlur);
      useProjectStore.setState({ optionKeyHeld: false, shiftKeyHeld: false });
    };
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  // Reverse lookup for findContainer. dnd-kit's onDragOver fires continuously
  // during a drag, while `items` changes only when a card crosses a column.
  const taskStatusByNumber = useMemo(() => {
    const lookup = new Map<number, TaskStatus>();
    for (const [status, tasks] of Object.entries(items)) {
      for (const t of tasks) lookup.set(t.taskNumber, status as TaskStatus);
    }
    return lookup;
  }, [items]);

  const findContainer = useCallback(
    (id: string): TaskStatus | null => {
      if (COLUMN_IDS.has(id)) return id as TaskStatus;
      const taskNum = parseInt(id.replace('task-', ''), 10);
      return taskStatusByNumber.get(taskNum) ?? null;
    },
    [taskStatusByNumber],
  );

  const [showTrash, setShowTrash] = useState(false);
  const [overTrash, setOverTrash] = useState(false);
  const overTrashRef = useRef(false);
  const trashRef = useRef<HTMLDivElement>(null);

  // Tracks pointer proximity to the right edge and the trash zone during a
  // drag, coalesced to one tick per frame since pointermove fires per pixel.
  useEffect(() => {
    if (!activeTask || activeBadgeDrag) {
      setShowTrash(false);
      setOverTrash(false);
      return;
    }
    const threshold = 200;
    let rafId: number | null = null;
    let lastX = 0;
    let lastY = 0;
    const flush = () => {
      rafId = null;
      const distFromRight = window.innerWidth - lastX;
      setShowTrash(distFromRight < threshold);

      const el = trashRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        const isOver = lastX >= rect.left && lastX <= rect.right && lastY >= rect.top && lastY <= rect.bottom;
        overTrashRef.current = isOver;
        setOverTrash(isOver);
      } else {
        overTrashRef.current = false;
        setOverTrash(false);
      }
    };
    const onMove = (e: PointerEvent) => {
      lastX = e.clientX;
      lastY = e.clientY;
      if (rafId == null) rafId = requestAnimationFrame(flush);
    };
    window.addEventListener('pointermove', onMove);
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, [activeTask, activeBadgeDrag]);

  // Track multi-drag: task numbers being dragged together (null = single drag)
  const multiDragRef = useRef<number[] | null>(null);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current;
    if (data?.type === 'badge') {
      multiDragRef.current = null;
      if (typeof data.taskNumber === 'number') useProjectStore.getState().setActiveBadgeDrag(data.taskNumber);
      setActiveTask(null);
    } else {
      const task = data?.task as TaskWithWorkspace | undefined;
      setActiveTask(task ?? null);
      useProjectStore.getState().setActiveBadgeDrag(null);
      if (task) originalStatusRef.current = task.status;

      const { selectedTaskNumbers } = useProjectStore.getState();
      if (task && selectedTaskNumbers.has(task.taskNumber) && selectedTaskNumbers.size > 1) {
        multiDragRef.current = [...selectedTaskNumbers];
      } else {
        multiDragRef.current = null;
        if (selectedTaskNumbers.size > 0) useProjectStore.getState().clearSelection();
      }
    }
  }, []);

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      if (!over) return;

      // Badge drags don't reorder cards — just track the hovered target
      if (active.data.current?.type === 'badge') {
        const overId = over.id as string;
        const overTaskNum = overId.startsWith('task-') ? parseInt(overId.replace('task-', ''), 10) : null;
        useProjectStore.getState().setBadgeDragOverTask(overTaskNum);
        return;
      }

      const activeId = active.id as string;
      const overId = over.id as string;
      const activeContainer = findContainer(activeId);
      const overContainer = findContainer(overId);

      if (!activeContainer || !overContainer || activeContainer === overContainer) return;

      const activeTaskNum = parseInt(activeId.replace('task-', ''), 10);

      setItems((prev) => {
        const sourceItems = [...(prev[activeContainer] ?? [])];
        const destItems = [...(prev[overContainer] ?? [])];

        const activeIndex = sourceItems.findIndex((t) => t.taskNumber === activeTaskNum);
        if (activeIndex === -1) return prev;

        const [movedTask] = sourceItems.splice(activeIndex, 1);
        const updatedTask = { ...movedTask, status: overContainer as TaskStatus };

        let overIndex = destItems.length;
        if (!COLUMN_IDS.has(overId)) {
          const overTaskNum = parseInt(overId.replace('task-', ''), 10);
          const idx = destItems.findIndex((t) => t.taskNumber === overTaskNum);
          if (idx !== -1) overIndex = idx;
        }

        destItems.splice(overIndex, 0, updatedTask);

        return {
          ...prev,
          [activeContainer]: sourceItems,
          [overContainer]: destItems,
        };
      });
    },
    [findContainer],
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;

      // ── Badge drop: link tasks ──────────────────────────────────────
      const badgeDrag = useProjectStore.getState().activeBadgeDrag;
      if (badgeDrag != null) {
        useProjectStore.getState().resetBadgeDragState();

        const overId = over?.id as string | undefined;
        if (!overId) return;

        const targetTaskNum = overId.startsWith('task-') ? parseInt(overId.replace('task-', ''), 10) : null;
        if (!targetTaskNum || targetTaskNum === badgeDrag) return;
        if (isDescendantOf(targetTaskNum, badgeDrag, chainMap)) return;

        const targetTask = storeTasks.find((t) => t.taskNumber === targetTaskNum);
        const result = await window.api.task.setParent(projectPath, badgeDrag, targetTaskNum, targetTask?.branch);
        if (result.success) {
          useProjectStore.getState().loadTasks(projectPath);
        } else {
          useProjectStore.getState().addToast(result.error || 'Failed to link tasks', 'error');
        }
        return;
      }

      // ── Card drop: reorder / trash ──────────────────────────────────
      let draggedTask = activeTask;
      const origStatus = originalStatusRef.current;
      const droppedOnTrash = overTrashRef.current;
      const multiDragTasks = multiDragRef.current;
      originalStatusRef.current = null;
      multiDragRef.current = null;

      if (!draggedTask) {
        setActiveTask(null);
        return;
      }

      const activeId = active.id as string;

      // Handle trash drop — use pointer-based hit test for consistency with visual state
      if (droppedOnTrash) {
        setActiveTask(null);
        if (multiDragTasks) {
          await Promise.allSettled(multiDragTasks.map((n) => window.api.task.trash(projectPath, n)));
          useProjectStore.getState().loadTasks(projectPath);
          useProjectStore.getState().clearSelection();
          useProjectStore.getState().addToast(`Moved ${multiDragTasks.length} tasks to trash`, 'success');
        } else {
          const taskNum = parseInt(activeId.replace('task-', ''), 10);
          await window.api.task.trash(projectPath, taskNum);
          useProjectStore.getState().loadTasks(projectPath);
          useProjectStore.getState().addToast('Task moved to trash', 'success');
        }
        return;
      }

      if (!over) {
        setActiveTask(null);
        return;
      }

      const overId = over.id as string;
      const activeContainer = findContainer(activeId);
      const overContainer = findContainer(overId);
      if (!activeContainer) {
        setActiveTask(null);
        return;
      }

      const finalContainer = overContainer || activeContainer;
      const activeTaskNum = parseInt(activeId.replace('task-', ''), 10);

      // ── Multi-drag: move all selected tasks to the target column ───
      if (multiDragTasks && multiDragTasks.length > 1) {
        setActiveTask(null);
        void bulkTransitionTasks(projectPath, multiDragTasks, finalContainer as TaskStatus);
        return;
      }

      // Handle reorder within same column
      let finalItems = items;
      if (activeContainer === finalContainer && !COLUMN_IDS.has(overId)) {
        const columnItems = items[activeContainer] ?? [];
        const activeIndex = columnItems.findIndex((t) => t.taskNumber === activeTaskNum);
        const overTaskNum = parseInt(overId.replace('task-', ''), 10);
        const overIndex = columnItems.findIndex((t) => t.taskNumber === overTaskNum);

        if (overIndex !== -1 && activeIndex !== -1 && activeIndex !== overIndex) {
          const reordered = arrayMove(columnItems, activeIndex, overIndex);
          finalItems = { ...items, [activeContainer]: reordered };
          setItems(finalItems);
        }
      }

      // Calculate target index from the final local state
      const targetColumn = finalItems[finalContainer] ?? [];
      const targetIndex = Math.max(
        0,
        targetColumn.findIndex((t) => t.taskNumber === activeTaskNum),
      );

      const newStatus = finalContainer as TaskStatus;

      // Done has its own lifecycle. Kanban, the terminal's Close Task menu and
      // the CLI all funnel through completeTask so they behave identically.
      if (newStatus === 'done' && origStatus && origStatus !== newStatus) {
        if (draggedTask.worktreePath) {
          const wtPath = await ensureWorktreeExists(draggedTask);
          if (!wtPath) {
            setActiveTask(null);
            return;
          }
          draggedTask = { ...draggedTask, worktreePath: wtPath };
        }
        // Plain drop prompts with the Done dialog (like every other column);
        // shift-drag skips the hook outright.
        const skipHook = useProjectStore.getState().shiftKeyHeld;
        setActiveTask(null);
        await completeTask({
          projectPath,
          task: draggedTask,
          targetIndex,
          hookControl: skipHook ? { mode: 'skip' } : undefined,
        });
        return;
      }

      // Persisted before the async work below, so clearing activeTask re-syncs
      // the effect to the new position rather than the old one.
      await useProjectStore.getState().moveTask(projectPath, activeTaskNum, finalContainer, targetIndex);
      setActiveTask(null);

      // A worktree may have been deleted outside the app; recover it before
      // starting a transition that assumes it exists.
      if (draggedTask.worktreePath) {
        const wtPath = await ensureWorktreeExists(draggedTask);
        if (!wtPath) return;
        draggedTask = { ...draggedTask, worktreePath: wtPath };
      }

      // The service runs worktree creation, the hook prompt and the terminal
      // spawn to completion whether or not this component stays mounted.
      if (!origStatus || origStatus === finalContainer) {
        // Pure reorder, no status change — nothing more to do.
        return;
      }
      beginTransition(projectPath, {
        origStatus,
        newStatus,
        task: draggedTask,
        onForegroundOpen: onHide,
      });
    },
    [activeTask, chainMap, storeTasks, items, findContainer, projectPath, ensureWorktreeExists, onHide],
  );

  // Task CRUD
  const handleAddTask = useCallback(
    async (name: string, description?: string) => {
      await window.api.task.create(projectPath, name, description);
      useProjectStore.getState().loadTasks(projectPath);
    },
    [projectPath],
  );

  const handleRenameTask = useCallback(
    async (taskNumber: number, newName: string) => {
      await window.api.task.setName(projectPath, taskNumber, newName);
      useProjectStore.getState().loadTasks(projectPath);
    },
    [projectPath],
  );

  const handleUpdateDescription = useCallback(
    async (taskNumber: number, description: string) => {
      await window.api.task.setDescription(projectPath, taskNumber, description);
      useProjectStore.getState().loadTasks(projectPath);
    },
    [projectPath],
  );

  const handleOpenTerminal = useCallback(
    async (task: TaskWithWorkspace, sandboxProvider?: SandboxProviderId) => {
      // A recovered worktree lands on `task` itself, so the spawn below sees it.
      if (task.branch && !(await ensureWorktreeExists(task))) return;
      if (await openTaskShell(projectPath, task, { sandboxProvider })) onHide();
    },
    [projectPath, onHide, ensureWorktreeExists],
  );

  const handleSwitchToTerminal = useCallback(
    (ptyId: string) => {
      void focusTerminal(ptyId, projectPath);
      onHide();
    },
    [projectPath, onHide],
  );

  const handleCardSelect = useCallback(
    (taskNumber: number, event: React.MouseEvent) => {
      const mod = isMac ? event.metaKey : event.ctrlKey;
      const store = useProjectStore.getState();
      if (event.shiftKey && store.selectionAnchor != null) {
        const allOrdered = COLUMNS.flatMap((col) => (items[col.status] ?? []).map((t) => t.taskNumber));
        store.selectTaskRange(taskNumber, allOrdered);
      } else if (mod || event.shiftKey) {
        store.toggleTaskSelection(taskNumber);
      }
    },
    [items],
  );

  const selectedTaskCount = useProjectStore((s) => s.selectedTaskNumbers.size);

  const handleConfigureHook = useCallback(
    async (hookTypes: HookType[]) => {
      const hooks = await window.api.hooks.get(projectPath);
      if (hookTypes.length === 2 && hookTypes.includes('start') && hookTypes.includes('continue')) {
        setHookDialog({
          mode: 'combined',
          start: hooks.start ?? undefined,
          continue: hooks.continue ?? undefined,
        });
      } else {
        const hookType = hookTypes[0];
        const existing = hooks[hookType] ?? undefined;
        setHookDialog({ mode: 'single', hookType, existingHook: existing });
      }
    },
    [projectPath],
  );

  const handleHookDialogClose = useCallback(() => {
    setHookDialog(null);
    // Refresh in the store so terminal headers and column badges agree.
    useProjectStore.getState().loadProjectConfig(projectPath);
  }, [projectPath]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={customCollision}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setActiveTask(null);
        useProjectStore.getState().resetBadgeDragState();
        originalStatusRef.current = null;
        multiDragRef.current = null;
      }}
    >
      <div
        className="kanban-board glass-bevel fixed top-[82px] bottom-4 z-[140] flex flex-col opacity-100 rounded-[14px] overflow-hidden border border-bezel-panel"
        style={{
          left: 'calc(var(--sidebar-offset, 0px) + 16px)',
          right: showTrash ? 144 : 16,
          transition: 'left 0.2s ease-out, right 0.2s ease-out',
          background: 'var(--color-terminal-bg)',
          boxShadow: 'var(--shadow-panel)',
        }}
      >
        {missingWorktreeDialog && (
          <MissingWorktreeDialog
            task={missingWorktreeDialog.task}
            branchExists={missingWorktreeDialog.branchExists}
            onClose={missingWorktreeDialog.resolve}
          />
        )}
        {hookDialog?.mode === 'single' && (
          <HookConfigDialog
            projectPath={projectPath}
            hookType={hookDialog.hookType}
            existingHook={hookDialog.existingHook}
            onClose={handleHookDialogClose}
          />
        )}
        {hookDialog?.mode === 'combined' && (
          <CombinedHookConfigDialog
            projectPath={projectPath}
            existingStart={hookDialog.start}
            existingContinue={hookDialog.continue}
            onClose={handleHookDialogClose}
          />
        )}
        <OnboardingPanel
          projectPath={projectPath}
          onConfigureCliAgent={() => handleConfigureHook(['start', 'continue'])}
          onOpenHelp={() => useAppStore.getState().setHelpDialogOpen(true)}
        />
        <div className="flex flex-1 min-h-0" style={{ overflowX: 'auto', overflowY: 'hidden' }}>
          {COLUMNS.map((col) => {
            const hookActive =
              (col.status === 'in_progress' && !!(configuredHooks.start || configuredHooks.continue)) ||
              (col.status === 'in_review' && !!configuredHooks.review) ||
              (col.status === 'done' && !!configuredHooks.done);

            return (
              <KanbanColumn
                key={col.status}
                status={col.status}
                label={col.label}
                tasks={items[col.status] ?? []}
                projectPath={projectPath}
                chainMap={chainMap}
                settingUpTaskNumbers={startingTaskNumbers}
                onAddTask={col.status === 'todo' ? handleAddTask : undefined}
                onRenameTask={handleRenameTask}
                onUpdateDescription={handleUpdateDescription}
                onOpenTerminal={handleOpenTerminal}
                onSwitchToTerminal={handleSwitchToTerminal}
                onSelect={handleCardSelect}
                onConfigureHook={handleConfigureHook}
                hasConfiguredHook={hookActive}
                availableSandboxProviders={availableSandboxProviders}
                hasEditorHook={!!configuredHooks.editor}
                onEditorHookConfigured={markEditorHookConfigured}
              />
            );
          })}
        </div>
        <KanbanShellBar projectPath={projectPath} onSwitchToTerminal={handleSwitchToTerminal} />
      </div>

      {selectedTaskCount > 0 && <BulkActionBar projectPath={projectPath} onOpenTerminal={handleOpenTerminal} />}

      <KanbanTrashZone ref={trashRef} visible={showTrash} isOver={overTrash} />

      <DragOverlay dropAnimation={null}>
        {activeTask && (
          <div
            className="px-3 py-3.5 relative"
            style={{
              background: 'var(--color-terminal-inset)',
              border: '1px solid var(--color-border)',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
              borderRadius: 0,
            }}
          >
            <div className="flex items-start gap-2">
              <span className="flex-1 text-[15px] text-text-primary min-w-0 break-words">{activeTask.name}</span>
            </div>
            {selectedTaskCount > 1 && (
              <span
                className="absolute -top-2 -right-2 flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-semibold text-accent-ink"
                style={{ background: 'var(--color-accent)' }}
              >
                {selectedTaskCount}
              </span>
            )}
          </div>
        )}
        {activeBadgeDrag != null && (
          <span
            className="inline-flex items-center gap-0.5 font-mono text-[11px] leading-none px-2 py-1 rounded-full whitespace-nowrap"
            style={{
              color: 'color-mix(in srgb, var(--color-ink) 70%, transparent)',
              background: 'var(--color-background-tertiary)',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
            }}
          >
            <span className="opacity-50">#</span>
            {activeBadgeDrag}
          </span>
        )}
      </DragOverlay>
    </DndContext>
  );
}

// ── Trash drop zone ──────────────────────────────────────────────────

const KanbanTrashZone = forwardRef<HTMLDivElement, { visible: boolean; isOver: boolean }>(function KanbanTrashZone(
  { visible, isOver },
  ref,
) {
  const { setNodeRef } = useDroppable({ id: TRASH_ID });

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
      }}
      className="fixed top-[82px] right-4 bottom-4 z-[140] flex flex-col items-center justify-center gap-2 overflow-hidden rounded-[14px]"
      style={{
        width: visible ? 120 : 0,
        opacity: visible ? 1 : 0,
        transition: 'width 0.2s ease-out, opacity 0.2s ease-out, background 150ms ease, color 150ms ease',

        background: isOver ? 'color-mix(in srgb, var(--color-error) 12%, transparent)' : 'var(--color-background)',
        color: isOver ? 'var(--color-error)' : 'var(--color-text-tertiary)',
      }}
    >
      <div className="[&>svg]:w-6 [&>svg]:h-6">
        <Icon name="trash" />
      </div>
      <span className="text-xs font-medium whitespace-nowrap">Move to Trash</span>
    </div>
  );
});
