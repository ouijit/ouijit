import { useMemo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { TaskWithWorkspace, HookType } from '../../types';
import { KanbanCard } from './KanbanCard';
import { KanbanAddInput } from './KanbanAddInput';
import { Icon } from '../terminal/Icon';

/** Map column status to the hook type(s) its config button should open */
const COLUMN_HOOK_TYPES: Record<string, HookType[]> = {
  todo: [],
  in_progress: ['start', 'continue'],
  in_review: ['review'],
  done: ['cleanup'],
};

interface KanbanColumnProps {
  status: string;
  label: string;
  tasks: TaskWithWorkspace[];
  projectPath: string;
  onAddTask?: (name: string) => void;
  onRenameTask: (taskNumber: number, newName: string) => void;
  onUpdateDescription: (taskNumber: number, description: string) => void;
  onOpenTerminal: (task: TaskWithWorkspace, sandboxed?: boolean) => void;
  onSwitchToTerminal: (ptyId: string) => void;
  onConfigureHook?: (hookTypes: HookType[]) => void;
  hasConfiguredHook?: boolean;
}

export function KanbanColumn({
  status,
  label,
  tasks,
  projectPath,
  onAddTask,
  onRenameTask,
  onUpdateDescription,
  onOpenTerminal,
  onSwitchToTerminal,
  onConfigureHook,
  hasConfiguredHook,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const taskIds = useMemo(() => tasks.map((t) => `task-${t.taskNumber}`), [tasks]);
  const hookTypes = COLUMN_HOOK_TYPES[status] ?? [];

  return (
    <div className="kanban-column" data-status={status}>
      <div className="kanban-column-header">
        <span className="kanban-column-title">
          {label}
          <span className="kanban-column-count">{tasks.length}</span>
        </span>
        {hookTypes.length > 0 && onConfigureHook && (
          <button
            className={`kanban-column-hook-btn${hasConfiguredHook ? ' kanban-column-hook-btn--active' : ''}`}
            onClick={() => onConfigureHook(hookTypes)}
          >
            <Icon name="webhooks-logo" />
          </button>
        )}
      </div>
      <div
        ref={setNodeRef}
        className="kanban-column-body"
        style={{
          minHeight: 80,
          background: isOver && tasks.length === 0 ? 'rgba(10, 132, 255, 0.08)' : undefined,
          transition: 'background 150ms ease',
        }}
      >
        <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <SortableCard
              key={task.taskNumber}
              task={task}
              projectPath={projectPath}
              onRename={onRenameTask}
              onUpdateDescription={onUpdateDescription}
              onOpenTerminal={onOpenTerminal}
              onSwitchToTerminal={onSwitchToTerminal}
            />
          ))}
        </SortableContext>
        {onAddTask && <KanbanAddInput onAdd={onAddTask} />}
      </div>
    </div>
  );
}

// ── Sortable wrapper ─────────────────────────────────────────────────

function SortableCard({
  task,
  projectPath,
  onRename,
  onUpdateDescription,
  onOpenTerminal,
  onSwitchToTerminal,
}: {
  task: TaskWithWorkspace;
  projectPath: string;
  onRename: (taskNumber: number, newName: string) => void;
  onUpdateDescription: (taskNumber: number, description: string) => void;
  onOpenTerminal: (task: TaskWithWorkspace, sandboxed?: boolean) => void;
  onSwitchToTerminal: (ptyId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `task-${task.taskNumber}`,
    data: { task },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  // When dragging, show the ghost placeholder (blue highlight, content hidden)
  if (isDragging) {
    return (
      <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="kanban-card--ghost">
        <div className="kanban-card">
          <div className="kanban-card-header">
            <span className="kanban-card-name">{task.name}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <KanbanCard
        task={task}
        projectPath={projectPath}
        onRename={onRename}
        onUpdateDescription={onUpdateDescription}
        onOpenTerminal={onOpenTerminal}
        onSwitchToTerminal={onSwitchToTerminal}
      />
    </div>
  );
}
