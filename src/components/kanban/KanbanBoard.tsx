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
import { useTerminalStore } from '../../stores/terminalStore';
import type { TaskWithWorkspace, TaskStatus, HookType } from '../../types';
import { addProjectTerminal, closeProjectTerminal } from '../terminal/terminalActions';
import { KanbanColumn } from './KanbanColumn';
import { BulkActionBar } from './BulkActionBar';
import { focusKanbanAddInput } from './KanbanAddInput';
import { HookConfigDialog } from '../dialogs/HookConfigDialog';
import { CombinedHookConfigDialog } from '../dialogs/CombinedHookConfigDialog';
import { MissingWorktreeDialog } from '../dialogs/MissingWorktreeDialog';
import { RunHookDialog, type RunHookResult } from '../dialogs/RunHookDialog';
import { Icon } from '../terminal/Icon';
import { buildChainMap, isDescendantOf } from '../../utils/taskChain';
import log from 'electron-log/renderer';

const kanbanLog = log.scope('kanban');

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: 'todo', label: 'To Do' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'in_review', label: 'In Review' },
  { status: 'done', label: 'Done' },
];
const COLUMN_IDS: Set<string> = new Set(COLUMNS.map((c) => c.status));
const TRASH_ID = 'trash-zone';

const isMac = navigator.platform.toLowerCase().includes('mac');

/**
 * Custom collision detection: try pointerWithin first (works for empty containers),
 * fall back to rectIntersection (works for sortable items within columns).
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
  const [activeTask, setActiveTask] = useState<TaskWithWorkspace | null>(null);
  const activeBadgeDrag = useProjectStore((s) => s.activeBadgeDrag);
  const [configuredHooks, setConfiguredHooks] = useState<Record<string, boolean>>({});
  const [runHookDialog, setRunHookDialog] = useState<{
    hookType: HookType;
    hook: any;
    task: TaskWithWorkspace;
    newStatus: TaskStatus;
  } | null>(null);
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
  const [settingUpTaskNumber, setSettingUpTaskNumber] = useState<number | null>(null);
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  /**
   * Check if a task's worktree exists on disk. If missing, prompt the user to recover it.
   * Returns the (possibly new) worktree path on success, or null if cancelled/failed.
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

  // Load which hooks are configured
  useEffect(() => {
    window.api.hooks.get(projectPath).then((hooks) => {
      const configured: Record<string, boolean> = {};
      for (const key of Object.keys(hooks)) {
        if (hooks[key as HookType]) configured[key] = true;
      }
      setConfiguredHooks(configured);
    });
  }, [projectPath]);

  // Local task state for drag preview — synced from store, mutated during drag
  const chainMap = useMemo(() => buildChainMap(storeTasks), [storeTasks]);
  const [items, setItems] = useState<Record<string, TaskWithWorkspace[]>>({});
  const originalStatusRef = useRef<string | null>(null);

  // Sync from store when not dragging
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

  // Load tasks on mount
  useEffect(() => {
    useProjectStore.getState().loadTasks(projectPath);
  }, [projectPath]);

  // Hotkeys
  const hasOpenDialog = !!(runHookDialog || hookDialog || missingWorktreeDialog);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (hasOpenDialog) return; // Let the dialog handle Escape
        const { selectedTaskNumbers, clearSelection } = useProjectStore.getState();
        if (selectedTaskNumbers.size > 0) {
          e.preventDefault();
          clearSelection();
          return; // First Escape deselects; second closes board
        }
        e.preventDefault();
        onHide();
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
  }, [onHide, hasOpenDialog]);

  // Track Option/Alt key for showing standalone badges
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useProjectStore.getState().optionKeyHeld !== e.altKey) {
        useProjectStore.setState({ optionKeyHeld: e.altKey });
      }
    };
    const onBlur = () => {
      if (useProjectStore.getState().optionKeyHeld) useProjectStore.setState({ optionKeyHeld: false });
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', onBlur);
      useProjectStore.setState({ optionKeyHeld: false });
    };
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const findContainer = useCallback(
    (id: string): TaskStatus | null => {
      if (COLUMN_IDS.has(id)) return id as TaskStatus;
      const taskNum = parseInt(id.replace('task-', ''), 10);
      for (const [status, tasks] of Object.entries(items)) {
        if (tasks.some((t) => t.taskNumber === taskNum)) return status as TaskStatus;
      }
      return null;
    },
    [items],
  );

  const [showTrash, setShowTrash] = useState(false);
  const [overTrash, setOverTrash] = useState(false);
  const overTrashRef = useRef(false);
  const trashRef = useRef<HTMLDivElement>(null);

  // Track pointer proximity to right edge during drag, and whether pointer is over the trash zone
  useEffect(() => {
    if (!activeTask || activeBadgeDrag) {
      setShowTrash(false);
      setOverTrash(false);
      return;
    }
    const threshold = 200;
    const onMove = (e: PointerEvent) => {
      const distFromRight = window.innerWidth - e.clientX;
      setShowTrash(distFromRight < threshold);

      const el = trashRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        const isOver =
          e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
        overTrashRef.current = isOver;
        setOverTrash(isOver);
      } else {
        overTrashRef.current = false;
        setOverTrash(false);
      }
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
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

      // If dragged card is in the selection, enter multi-drag mode
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

        // Determine insertion index
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
          if (!mountedRef.current) return;
          useProjectStore.getState().loadTasks(projectPath);
          useProjectStore.getState().clearSelection();
          useProjectStore.getState().addToast(`Deleted ${multiDragTasks.length} tasks`, 'success');
        } else {
          const taskNum = parseInt(activeId.replace('task-', ''), 10);
          await window.api.task.trash(projectPath, taskNum);
          if (!mountedRef.current) return;
          useProjectStore.getState().loadTasks(projectPath);
          useProjectStore.getState().addToast('Task deleted', 'success');
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
        const newStatus = finalContainer as TaskStatus;
        await Promise.allSettled(multiDragTasks.map((n) => window.api.task.setStatus(projectPath, n, newStatus)));
        if (!mountedRef.current) return;
        useProjectStore.getState().loadTasks(projectPath);
        useProjectStore.getState().clearSelection();
        const label = { todo: 'To Do', in_progress: 'In Progress', in_review: 'In Review', done: 'Done' }[newStatus];
        useProjectStore.getState().addToast(`Moved ${multiDragTasks.length} tasks to ${label}`, 'success');
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

      // Persist status + position optimistically BEFORE async work (worktree creation, etc.)
      // This updates the store so that when we clear activeTask the effect re-syncs to the new position.
      await useProjectStore.getState().moveTask(projectPath, activeTaskNum, finalContainer, targetIndex);
      if (!mountedRef.current) return;
      setActiveTask(null);

      // Create worktree BEFORE moving (while task is still todo)
      if (newStatus === 'in_progress' && !draggedTask.worktreePath) {
        setSettingUpTaskNumber(draggedTask.taskNumber);
        const startResult = await window.api.task.start(projectPath, draggedTask.taskNumber);
        if (!mountedRef.current) return;
        setSettingUpTaskNumber(null);
        if (!startResult.success) {
          useProjectStore.getState().addToast(startResult.error || 'Failed to create worktree', 'error');
        } else if (startResult.worktreePath) {
          // Update the captured task so executeTransition uses the existing worktree
          draggedTask = {
            ...draggedTask,
            worktreePath: startResult.worktreePath,
            branch: startResult.task?.branch || draggedTask.branch,
          };
        }
      }

      // Verify existing worktree is still on disk; offer recovery if missing
      if (draggedTask.worktreePath) {
        const wtPath = await ensureWorktreeExists(draggedTask);
        if (!mountedRef.current) return;
        if (!wtPath) return;
        draggedTask = { ...draggedTask, worktreePath: wtPath };
      }

      await useProjectStore.getState().loadTasks(projectPath);
      if (!mountedRef.current) return;

      // Show hook dialog if configured for this transition
      if (origStatus && origStatus !== finalContainer) {
        const hooks = await window.api.hooks.get(projectPath);
        if (!mountedRef.current) return;
        let hookType: HookType | null = null;
        let hook = null;

        if (newStatus === 'in_progress') {
          hookType = origStatus === 'todo' ? 'start' : 'continue';
          hook = hooks[hookType] ?? null;
        } else if (newStatus === 'in_review') {
          hookType = 'review';
          hook = hooks.review ?? null;
        } else if (newStatus === 'done') {
          hookType = 'cleanup';
          hook = hooks.cleanup ?? null;
        }

        if (hook && hookType) {
          setRunHookDialog({ hookType, hook, task: draggedTask, newStatus });
        }
      }
    },
    [activeTask, chainMap, storeTasks, items, findContainer, projectPath, ensureWorktreeExists],
  );

  // Task CRUD
  const handleAddTask = useCallback(
    async (name: string) => {
      await window.api.task.create(projectPath, name);
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
    async (task: TaskWithWorkspace, sandboxed?: boolean) => {
      if (task.worktreePath && task.branch) {
        const wtPath = await ensureWorktreeExists(task);
        if (!wtPath) return;
        await addProjectTerminal(projectPath, undefined, {
          existingWorktree: { path: wtPath, branch: task.branch, createdAt: task.createdAt },
          taskId: task.taskNumber,
          sandboxed,
        });
      } else if (task.branch) {
        // Has a branch but lost its worktree — recover via dialog
        const wtPath = await ensureWorktreeExists(task);
        if (!wtPath) return;
        await addProjectTerminal(projectPath, undefined, {
          existingWorktree: { path: wtPath, branch: task.branch, createdAt: task.createdAt },
          taskId: task.taskNumber,
          sandboxed,
        });
      } else {
        // No worktree or branch yet — beginTask creates worktree + sets in_progress
        const startResult = await window.api.task.start(projectPath, task.taskNumber);
        if (!startResult.success || !startResult.worktreePath) {
          useProjectStore.getState().addToast(startResult.error || 'Failed to start task', 'error');
          return;
        }
        useProjectStore.getState().loadTasks(projectPath);
        await addProjectTerminal(projectPath, undefined, {
          existingWorktree: {
            path: startResult.worktreePath,
            branch: startResult.task?.branch || '',
            createdAt: task.createdAt,
          },
          taskId: task.taskNumber,
          skipAutoHook: true,
        });
      }
      onHide();
    },
    [projectPath, onHide, ensureWorktreeExists],
  );

  const handleSwitchToTerminal = useCallback(
    (ptyId: string) => {
      const store = useTerminalStore.getState();
      const terminals = store.terminalsByProject[projectPath] ?? [];
      const index = terminals.indexOf(ptyId);
      if (index !== -1) {
        store.setActiveIndex(projectPath, index);
      }
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

  const handleRunHookClose = useCallback(
    async (result: RunHookResult | null) => {
      const dialog = runHookDialog;
      setRunHookDialog(null);
      if (!dialog) return;

      if (result) {
        await executeTransition(projectPath, dialog.task, dialog.newStatus, result, onHide);
      }
      // Cancelled — do nothing, task already moved in the board
    },
    [runHookDialog, projectPath, onHide],
  );

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
    // Refresh configured hooks
    window.api.hooks.get(projectPath).then((hooks) => {
      const configured: Record<string, boolean> = {};
      for (const key of Object.keys(hooks)) {
        if (hooks[key as HookType]) configured[key] = true;
      }
      setConfiguredHooks(configured);
    });
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
        className="kanban-board glass-bevel fixed top-[82px] bottom-4 z-[140] flex flex-col opacity-100 rounded-[14px] overflow-hidden border border-black/60"
        style={{
          left: 'calc(var(--sidebar-offset, 0px) + 16px)',
          right: showTrash ? 144 : 16,
          transition: 'left 0.2s ease-out, right 0.2s ease-out',
          background: 'var(--color-terminal-bg, #171717)',
          boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.05), 0 4px 12px rgba(0, 0, 0, 0.15), 0 20px 40px rgba(0, 0, 0, 0.2)',
        }}
      >
        {missingWorktreeDialog && (
          <MissingWorktreeDialog
            task={missingWorktreeDialog.task}
            branchExists={missingWorktreeDialog.branchExists}
            onClose={missingWorktreeDialog.resolve}
          />
        )}
        {runHookDialog && (
          <RunHookDialog
            hookType={runHookDialog.hookType}
            hook={runHookDialog.hook}
            projectPath={projectPath}
            onClose={handleRunHookClose}
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
        <div className="flex flex-1 min-h-0" style={{ overflowX: 'auto', overflowY: 'hidden' }}>
          {COLUMNS.map((col) => {
            const hookActive =
              (col.status === 'in_progress' && !!(configuredHooks.start || configuredHooks.continue)) ||
              (col.status === 'in_review' && !!configuredHooks.review) ||
              (col.status === 'done' && !!configuredHooks.cleanup);

            return (
              <KanbanColumn
                key={col.status}
                status={col.status}
                label={col.label}
                tasks={items[col.status] ?? []}
                projectPath={projectPath}
                chainMap={chainMap}
                settingUpTaskNumber={settingUpTaskNumber}
                onAddTask={col.status === 'todo' ? handleAddTask : undefined}
                onRenameTask={handleRenameTask}
                onUpdateDescription={handleUpdateDescription}
                onOpenTerminal={handleOpenTerminal}
                onSwitchToTerminal={handleSwitchToTerminal}
                onSelect={handleCardSelect}
                onConfigureHook={handleConfigureHook}
                hasConfiguredHook={hookActive}
              />
            );
          })}
        </div>
      </div>

      {selectedTaskCount > 0 && <BulkActionBar projectPath={projectPath} onOpenTerminal={handleOpenTerminal} />}

      <KanbanTrashZone ref={trashRef} visible={showTrash} isOver={overTrash} />

      <DragOverlay dropAnimation={null}>
        {activeTask && (
          <div
            className="px-3 py-3.5 relative"
            style={{
              background: '#111111',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
              borderRadius: 0,
            }}
          >
            <div className="flex items-start gap-2">
              <span className="flex-1 font-mono text-sm font-medium text-text-primary min-w-0 break-words">
                {activeTask.name}
              </span>
            </div>
            {selectedTaskCount > 1 && (
              <span
                className="absolute -top-2 -right-2 flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-semibold text-white"
                style={{ background: '#0A84FF' }}
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
              color: 'rgba(255, 255, 255, 0.7)',
              background: 'rgba(255, 255, 255, 0.12)',
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

        background: isOver ? 'rgba(255, 69, 58, 0.12)' : 'var(--color-background)',
        color: isOver ? 'var(--color-error, #ff453a)' : 'var(--color-text-tertiary)',
      }}
    >
      <div className="[&>svg]:w-6 [&>svg]:h-6">
        <Icon name="trash" />
      </div>
      <span className="text-xs font-medium whitespace-nowrap">Delete</span>
    </div>
  );
});

// ── Column transition lifecycle ──────────────────────────────────────

async function executeTransition(
  projectPath: string,
  task: TaskWithWorkspace,
  newStatus: TaskStatus,
  hookResult: RunHookResult | undefined,
  onHide: () => void,
): Promise<void> {
  if (newStatus === 'in_progress' && hookResult) {
    const runConfig = { name: 'Start', command: hookResult.command, source: 'custom' as const, priority: 0 };
    if (!task.worktreePath) {
      await addProjectTerminal(projectPath, runConfig, {
        useWorktree: true,
        worktreeName: task.name,
        taskId: task.taskNumber,
        sandboxed: hookResult.sandboxed,
      });
    } else {
      await addProjectTerminal(projectPath, runConfig, {
        existingWorktree: { path: task.worktreePath, branch: task.branch || '', createdAt: task.createdAt },
        taskId: task.taskNumber,
        sandboxed: hookResult.sandboxed,
        skipAutoHook: true,
      });
    }
    if (hookResult.foreground) onHide();
  } else if (newStatus === 'in_review') {
    if (hookResult && task.worktreePath) {
      await addProjectTerminal(
        projectPath,
        { name: 'Review', command: hookResult.command, source: 'custom', priority: 0 },
        {
          existingWorktree: { path: task.worktreePath, branch: task.branch || '', createdAt: task.createdAt },
          taskId: task.taskNumber,
          skipAutoHook: true,
          sandboxed: hookResult.sandboxed,
          background: !hookResult.foreground,
        },
      );
      if (hookResult.foreground) onHide();
    }
  } else if (newStatus === 'done') {
    if (hookResult && task.worktreePath) {
      await addProjectTerminal(
        projectPath,
        { name: 'Cleanup', command: hookResult.command, source: 'custom', priority: 0 },
        {
          existingWorktree: { path: task.worktreePath, branch: task.branch || '', createdAt: task.createdAt },
          taskId: task.taskNumber,
          skipAutoHook: true,
          sandboxed: hookResult.sandboxed,
          background: !hookResult.foreground,
        },
      );
      if (hookResult.foreground) onHide();
    }
    // Close all terminals for this task
    const store = useTerminalStore.getState();
    const ptyIds = store.terminalsByProject[projectPath] ?? [];
    for (const ptyId of [...ptyIds]) {
      const display = store.displayStates[ptyId];
      if (display?.taskId === task.taskNumber) {
        closeProjectTerminal(ptyId);
      }
    }
  }
}
