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
  const [hookDialog, setHookDialog] = useState<{ hookType: HookType; existingHook?: any } | null>(null);
  const pendingHookTypesRef = useRef<HookType[]>([]);

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
        await handleColumnTransition(projectPath, draggedTask, finalContainer as TaskStatus, onHide);
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

  const showNextHookDialog = useCallback(
    async (hookTypes: HookType[]) => {
      if (hookTypes.length === 0) {
        setHookDialog(null);
        return;
      }
      const [next, ...rest] = hookTypes;
      pendingHookTypesRef.current = rest;
      const hooks = await window.api.hooks.get(projectPath);
      const existing = hooks[next as keyof typeof hooks] as any;
      setHookDialog({ hookType: next, existingHook: existing || undefined });
    },
    [projectPath],
  );

  const handleConfigureHook = useCallback(
    (hookTypes: HookType[]) => {
      showNextHookDialog(hookTypes);
    },
    [showNextHookDialog],
  );

  const handleHookDialogClose = useCallback(() => {
    const remaining = pendingHookTypesRef.current;
    if (remaining.length > 0) {
      showNextHookDialog(remaining);
    } else {
      setHookDialog(null);
    }
  }, [showNextHookDialog]);

  return (
    <div className="kanban-board kanban-board--visible">
      {hookDialog && (
        <HookConfigDialog
          projectPath={projectPath}
          hookType={hookDialog.hookType}
          existingHook={hookDialog.existingHook}
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
          {COLUMNS.map((col) => (
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
            />
          ))}
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

async function handleColumnTransition(
  projectPath: string,
  task: TaskWithWorkspace,
  newStatus: TaskStatus,
  onHide: () => void,
): Promise<void> {
  if (newStatus === 'in_progress') {
    if (!task.worktreePath) {
      await addProjectTerminal(projectPath, undefined, {
        useWorktree: true,
        worktreeName: task.name,
        taskId: task.taskNumber,
      });
    } else {
      await addProjectTerminal(projectPath, undefined, {
        existingWorktree: { path: task.worktreePath, branch: task.branch || '', createdAt: task.createdAt },
        taskId: task.taskNumber,
      });
    }
    onHide();
  } else if (newStatus === 'done') {
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
