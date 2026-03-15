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
  type DragOverEvent,
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
  const [localTasks, setLocalTasks] = useState<TaskWithWorkspace[]>(tasks);

  // Sync localTasks when store tasks change (from IPC)
  useEffect(() => {
    setLocalTasks(tasks);
  }, [tasks]);

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
    for (const task of localTasks) {
      if (groups[task.status]) {
        groups[task.status].push(task);
      }
    }
    // Sort by order within each column
    for (const status of Object.keys(groups)) {
      groups[status].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    }
    return groups;
  }, [localTasks]);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const task = event.active.data.current?.task as TaskWithWorkspace | undefined;
    setActiveTask(task ?? null);
  }, []);

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      if (!over) return;

      const activeId = active.id as string;
      const overId = over.id as string;

      // Find source and destination columns
      const activeTaskNum = parseInt(activeId.replace('task-', ''), 10);
      const activeTaskData = localTasks.find((t) => t.taskNumber === activeTaskNum);
      if (!activeTaskData) return;

      // Determine target column: either a column id directly or from a task's column
      let targetStatus: string;
      if (COLUMNS.some((c) => c.status === overId)) {
        targetStatus = overId;
      } else {
        const overTaskNum = parseInt(overId.replace('task-', ''), 10);
        const overTask = localTasks.find((t) => t.taskNumber === overTaskNum);
        if (!overTask) return;
        targetStatus = overTask.status;
      }

      if (activeTaskData.status !== targetStatus) {
        // Move task to new column optimistically
        setLocalTasks((prev) => {
          const updated = prev.map((t) =>
            t.taskNumber === activeTaskNum ? { ...t, status: targetStatus as TaskStatus } : t,
          );
          return updated;
        });
      }
    },
    [localTasks],
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveTask(null);
      const { active, over } = event;
      if (!over) return;

      const activeId = active.id as string;
      const overId = over.id as string;
      const activeTaskNum = parseInt(activeId.replace('task-', ''), 10);

      // Find the task in localTasks (may have been moved to new column in handleDragOver)
      const task = localTasks.find((t) => t.taskNumber === activeTaskNum);
      if (!task) return;

      const targetStatus = task.status;

      // Calculate target index within the column
      const columnTasks = localTasks.filter((t) => t.status === targetStatus);
      let targetIndex = columnTasks.findIndex((t) => t.taskNumber === activeTaskNum);

      if (overId !== activeId && !COLUMNS.some((c) => c.status === overId)) {
        // Dropped on another task — reorder within column
        const overTaskNum = parseInt(overId.replace('task-', ''), 10);
        const overIndex = columnTasks.findIndex((t) => t.taskNumber === overTaskNum);
        if (overIndex !== -1) {
          targetIndex = overIndex;
        }
      }

      // Persist to backend
      useProjectStore.getState().moveTask(projectPath, activeTaskNum, targetStatus, Math.max(0, targetIndex));

      // Handle lifecycle hooks for column transitions
      const originalTask = tasks.find((t) => t.taskNumber === activeTaskNum);
      if (originalTask && originalTask.status !== targetStatus) {
        await handleColumnTransition(projectPath, originalTask, targetStatus as TaskStatus);
      }
    },
    [localTasks, tasks, projectPath],
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
        onDragOver={handleDragOver}
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
            <div className="kanban-card" style={{ opacity: 0.8 }}>
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
): Promise<void> {
  if (newStatus === 'in_progress') {
    // Create worktree if needed and open terminal
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
  } else if (newStatus === 'done') {
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
