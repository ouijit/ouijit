import { useEffect, useCallback, useState, useRef } from 'react';
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  rectIntersection,
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
import { focusKanbanAddInput } from './KanbanAddInput';
import { HookConfigDialog } from '../dialogs/HookConfigDialog';
import { CombinedHookConfigDialog } from '../dialogs/CombinedHookConfigDialog';
import { RunHookDialog, type RunHookResult } from '../dialogs/RunHookDialog';

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: 'todo', label: 'To Do' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'in_review', label: 'In Review' },
  { status: 'done', label: 'Done' },
];
const COLUMN_IDS: Set<string> = new Set(COLUMNS.map((c) => c.status));

const isMac = navigator.platform.toLowerCase().includes('mac');

/**
 * Custom collision detection: try pointerWithin first (works for empty containers),
 * fall back to rectIntersection (works for sortable items within columns).
 */
const customCollision: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) return pointerCollisions;
  return rectIntersection(args);
};

interface KanbanBoardProps {
  projectPath: string;
  onHide: () => void;
}

export function KanbanBoard({ projectPath, onHide }: KanbanBoardProps) {
  const storeTasks = useProjectStore((s) => s.tasks);
  const [activeTask, setActiveTask] = useState<TaskWithWorkspace | null>(null);
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

  // Load which hooks are configured
  useEffect(() => {
    window.api.hooks.get(projectPath).then((hooks) => {
      const configured: Record<string, boolean> = {};
      for (const key of Object.keys(hooks)) {
        if ((hooks as any)[key]) configured[key] = true;
      }
      setConfiguredHooks(configured);
    });
  }, [projectPath]);

  // Local task state for drag preview — synced from store, mutated during drag
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
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
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
  }, [onHide]);

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

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const task = event.active.data.current?.task as TaskWithWorkspace | undefined;
    setActiveTask(task ?? null);
    if (task) originalStatusRef.current = task.status;
  }, []);

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      if (!over) return;

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
      const draggedTask = activeTask;
      const origStatus = originalStatusRef.current;
      setActiveTask(null);
      originalStatusRef.current = null;

      const { active, over } = event;
      if (!over || !draggedTask) return;

      const activeId = active.id as string;
      const overId = over.id as string;
      const activeContainer = findContainer(activeId);
      const overContainer = findContainer(overId);
      if (!activeContainer) return;

      const finalContainer = overContainer || activeContainer;
      const activeTaskNum = parseInt(activeId.replace('task-', ''), 10);

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

      // Persist to backend
      await useProjectStore.getState().moveTask(projectPath, activeTaskNum, finalContainer, targetIndex);
      await useProjectStore.getState().loadTasks(projectPath);

      // Handle lifecycle transitions
      if (origStatus && origStatus !== finalContainer) {
        const hooks = await window.api.hooks.get(projectPath);
        const newStatus = finalContainer as TaskStatus;

        // Only show dialog if a hook is configured for this transition
        let hookType: HookType | null = null;
        let hook = null;

        if (newStatus === 'in_progress') {
          hookType = origStatus === 'todo' ? 'start' : 'continue';
          hook = (hooks as any)[hookType] || null;
        } else if (newStatus === 'in_review') {
          hookType = 'review';
          hook = (hooks as any).review || null;
        } else if (newStatus === 'done') {
          hookType = 'cleanup';
          hook = (hooks as any).cleanup || null;
        }

        // Create worktree when moving to in_progress if task doesn't have one
        if (newStatus === 'in_progress' && !draggedTask.worktreePath) {
          const startResult = await window.api.task.start(projectPath, draggedTask.taskNumber);
          if (!startResult.success) {
            useProjectStore.getState().addToast(startResult.error || 'Failed to create worktree', 'error');
          }
          await useProjectStore.getState().loadTasks(projectPath);
        }

        if (hook && hookType) {
          setRunHookDialog({ hookType, hook, task: draggedTask, newStatus });
        }
      }
    },
    [activeTask, items, findContainer, projectPath, onHide],
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
    },
    [projectPath],
  );

  const handleOpenTerminal = useCallback(
    async (task: TaskWithWorkspace, sandboxed?: boolean) => {
      if (task.worktreePath && task.branch) {
        await addProjectTerminal(projectPath, undefined, {
          existingWorktree: { path: task.worktreePath, branch: task.branch, createdAt: task.createdAt },
          taskId: task.taskNumber,
          sandboxed,
        });
      } else {
        // No worktree yet — create one
        const startResult = await window.api.task.start(projectPath, task.taskNumber);
        if (!startResult.success || !startResult.worktreePath) {
          useProjectStore.getState().addToast(startResult.error || 'Failed to start task', 'error');
          return;
        }
        useProjectStore.getState().loadTasks(projectPath);
      }
      onHide();
    },
    [projectPath, onHide],
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
          start: (hooks as any).start || undefined,
          continue: (hooks as any).continue || undefined,
        });
      } else {
        const hookType = hookTypes[0];
        const existing = (hooks as any)[hookType] || undefined;
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
        if ((hooks as any)[key]) configured[key] = true;
      }
      setConfiguredHooks(configured);
    });
  }, [projectPath]);

  return (
    <div className="kanban-board kanban-board--visible">
      {runHookDialog && (
        <RunHookDialog
          hookType={runHookDialog.hookType}
          hook={runHookDialog.hook}
          taskName={runHookDialog.task.name}
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
      <DndContext
        sensors={sensors}
        collisionDetection={customCollision}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="kanban-columns">
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
                onAddTask={col.status === 'todo' ? handleAddTask : undefined}
                onRenameTask={handleRenameTask}
                onUpdateDescription={handleUpdateDescription}
                onOpenTerminal={handleOpenTerminal}
                onSwitchToTerminal={handleSwitchToTerminal}
                onConfigureHook={handleConfigureHook}
                hasConfiguredHook={hookActive}
              />
            );
          })}
        </div>

        <DragOverlay dropAnimation={null}>
          {activeTask && (
            <div
              className="kanban-card"
              style={{
                background: '#111111',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
                borderRadius: 0,
              }}
            >
              <div className="kanban-card-header">
                <span className="kanban-card-name">{activeTask.name}</span>
              </div>
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

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
