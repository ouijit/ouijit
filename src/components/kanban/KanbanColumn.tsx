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
    <div
      className="kanban-column flex flex-col transition-all duration-150 ease-out shrink-0 last:border-r-0"
      style={{ minWidth: 240, flex: '1 0 240px', borderRight: '1px solid rgba(255, 255, 255, 0.06)' }}
      data-status={status}
    >
      <div className="flex items-center gap-2 px-3 py-2.5 shrink-0 h-[46px]">
        <span className="text-[13px] font-medium text-text-secondary uppercase tracking-wide flex-1">
          {label}
          <span className="kanban-column-count text-text-secondary opacity-50 normal-case tracking-normal ml-1.5">
            {tasks.length}
          </span>
        </span>
        {hookTypes.length > 0 && onConfigureHook && (
          <button
            className={`flex items-center justify-center border-none text-text-tertiary transition-all duration-150 ease-out rounded-md hover:text-text-secondary hover:bg-white/[0.08] [&>svg]:w-[18px] [&>svg]:h-[18px]${hasConfiguredHook ? ' !text-accent hover:!text-accent-hover' : ''}`}
            style={{ padding: '4px 10px', background: 'transparent' }}
            onClick={() => onConfigureHook(hookTypes)}
          >
            <Icon name="webhooks-logo" />
          </button>
        )}
      </div>
      <div
        ref={setNodeRef}
        className="kanban-column-body flex flex-col overflow-y-auto flex-1 min-h-0"
        style={{
          borderTop: '1px solid rgba(255, 255, 255, 0.06)',
          scrollbarColor: 'transparent transparent',
          transition: 'background 150ms ease',
          minHeight: 80,
          background: isOver && tasks.length === 0 ? 'rgba(10, 132, 255, 0.08)' : undefined,
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
      <div
        ref={setNodeRef}
        style={{ ...style, background: 'rgba(10, 132, 255, 0.15)', border: '1px solid rgba(10, 132, 255, 0.4)' }}
        {...attributes}
        {...listeners}
        className="[&>*]:opacity-0"
      >
        <div className="px-3 py-3.5" style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
          <div className="flex items-start gap-2">
            <span className="flex-1 font-mono text-sm font-medium text-text-primary min-w-0 break-words">
              {task.name}
            </span>
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
