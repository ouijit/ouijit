import { useMemo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { TaskWithWorkspace } from '../../types';
import { KanbanCard } from './KanbanCard';
import { KanbanAddInput } from './KanbanAddInput';

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
}: KanbanColumnProps) {
  const { setNodeRef } = useDroppable({ id: status });
  const taskIds = useMemo(() => tasks.map((t) => `task-${t.taskNumber}`), [tasks]);

  return (
    <div className="kanban-column" data-status={status}>
      <div className="kanban-column-header">
        <span className="kanban-column-title">
          {label}
          <span className="kanban-column-count">{tasks.length}</span>
        </span>
      </div>
      <div ref={setNodeRef} className="kanban-column-body">
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

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

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
