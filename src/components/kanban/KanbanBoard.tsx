import { useEffect, useCallback, useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useProjectStore } from '../../stores/projectStore';
import { useTerminalStore } from '../../stores/terminalStore';
import type { TaskWithWorkspace, TaskStatus } from '../../types';
import { addProjectTerminal, closeProjectTerminal } from '../terminal/terminalActions';
import { KanbanColumn } from './KanbanColumn';
import { focusKanbanAddInput } from './KanbanAddInput';

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: 'todo', label: 'To Do' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'in_review', label: 'In Review' },
  { status: 'done', label: 'Done' },
];

const isMac = navigator.platform.toLowerCase().includes('mac');

interface KanbanBoardProps {
  projectPath: string;
  onHide: () => void;
}

export function KanbanBoard({ projectPath, onHide }: KanbanBoardProps) {
  const tasks = useProjectStore((s) => s.tasks);
  const [activeTask, setActiveTask] = useState<TaskWithWorkspace | null>(null);

  // Load tasks on mount
  useEffect(() => {
    useProjectStore.getState().loadTasks(projectPath);
  }, [projectPath]);

  // Hotkeys: Escape to hide, Cmd+N to focus input
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

  // Group tasks by status
  const tasksByStatus = useMemo(() => {
    const groups: Record<string, TaskWithWorkspace[]> = {};
    for (const col of COLUMNS) {
      groups[col.status] = [];
    }
    for (const task of tasks) {
      if (groups[task.status]) {
        groups[task.status].push(task);
      }
    }
    for (const status of Object.keys(groups)) {
      groups[status].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    }
    return groups;
  }, [tasks]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const task = event.active.data.current?.task as TaskWithWorkspace | undefined;
    setActiveTask(task ?? null);
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const draggedTask = activeTask;
      setActiveTask(null);

      const { over } = event;
      if (!over || !draggedTask) return;

      const overId = over.id as string;

      // Determine target column
      let targetStatus: TaskStatus;
      let targetIndex = 0;

      if (COLUMNS.some((c) => c.status === overId)) {
        // Dropped on a column directly (empty area)
        targetStatus = overId as TaskStatus;
        targetIndex = (tasksByStatus[targetStatus] ?? []).length;
      } else {
        // Dropped on a task — use that task's column and position
        const overTaskNum = parseInt(overId.replace('task-', ''), 10);
        const overTask = tasks.find((t) => t.taskNumber === overTaskNum);
        if (!overTask) return;
        targetStatus = overTask.status as TaskStatus;
        const columnTasks = tasksByStatus[targetStatus] ?? [];
        targetIndex = columnTasks.findIndex((t) => t.taskNumber === overTaskNum);
        if (targetIndex === -1) targetIndex = columnTasks.length;
      }

      // No-op if same position
      if (draggedTask.status === targetStatus) {
        const columnTasks = tasksByStatus[targetStatus] ?? [];
        const currentIndex = columnTasks.findIndex((t) => t.taskNumber === draggedTask.taskNumber);
        if (currentIndex === targetIndex) return;
      }

      const originalStatus = draggedTask.status;

      // Persist to backend (optimistic update happens in store)
      await useProjectStore
        .getState()
        .moveTask(projectPath, draggedTask.taskNumber, targetStatus, Math.max(0, targetIndex));

      // Reload tasks to get fresh state
      await useProjectStore.getState().loadTasks(projectPath);

      // Handle lifecycle for column transitions
      if (originalStatus !== targetStatus) {
        await handleColumnTransition(projectPath, draggedTask, targetStatus, onHide);
      }
    },
    [activeTask, tasks, tasksByStatus, projectPath, onHide],
  );

  // Task CRUD handlers
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

  return (
    <div className="kanban-board kanban-board--visible">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="kanban-columns">
          {COLUMNS.map((col) => (
            <KanbanColumn
              key={col.status}
              status={col.status}
              label={col.label}
              tasks={tasksByStatus[col.status] ?? []}
              projectPath={projectPath}
              onAddTask={col.status === 'todo' ? handleAddTask : undefined}
              onRenameTask={handleRenameTask}
              onUpdateDescription={handleUpdateDescription}
              onOpenTerminal={handleOpenTerminal}
              onSwitchToTerminal={handleSwitchToTerminal}
            />
          ))}
        </div>

        <DragOverlay>
          {activeTask && (
            <div className="kanban-card" style={{ opacity: 0.8, width: 280 }}>
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
    // Switch to terminal view so user sees the new terminal
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
