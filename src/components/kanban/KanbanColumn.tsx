import { useMemo, type MouseEvent } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { TaskWithWorkspace, HookType } from '../../types';
import type { TaskChainInfo } from '../../utils/taskChain';
import { useProjectStore } from '../../stores/projectStore';
import { KanbanCard } from './KanbanCard';
import { KanbanAddInput } from './KanbanAddInput';
import { KanbanColumnView } from './KanbanColumnView';

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
  settingUpTaskNumbers?: ReadonlySet<number>;
  onAddTask?: (name: string, description?: string) => void;
  onRenameTask: (taskNumber: number, newName: string) => void;
  onUpdateDescription: (taskNumber: number, description: string) => void;
  onOpenTerminal: (task: TaskWithWorkspace, sandboxed?: boolean) => void;
  onSwitchToTerminal: (ptyId: string) => void;
  onSelect: (taskNumber: number, event: MouseEvent) => void;
  onConfigureHook?: (hookTypes: HookType[]) => void;
  hasConfiguredHook?: boolean;
  chainMap?: Map<number, TaskChainInfo>;
  sandboxAvailable?: boolean;
  hasEditorHook?: boolean;
  onEditorHookConfigured?: () => void;
}

export function KanbanColumn({
  status,
  label,
  tasks,
  projectPath,
  settingUpTaskNumbers,
  onAddTask,
  onRenameTask,
  onUpdateDescription,
  onOpenTerminal,
  onSwitchToTerminal,
  onSelect,
  onConfigureHook,
  hasConfiguredHook,
  chainMap,
  sandboxAvailable,
  hasEditorHook,
  onEditorHookConfigured,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const taskIds = useMemo(() => tasks.map((t) => `task-${t.taskNumber}`), [tasks]);
  const hookTypes = COLUMN_HOOK_TYPES[status] ?? [];

  const showOverHighlight = isOver && tasks.length === 0;

  return (
    <KanbanColumnView
      status={status}
      label={label}
      count={tasks.length}
      hookTypes={hookTypes}
      hasConfiguredHook={hasConfiguredHook}
      onConfigureHook={onConfigureHook}
      isOver={showOverHighlight}
      bodyRef={setNodeRef}
      onBodyClick={(e) => {
        if (e.target === e.currentTarget) useProjectStore.getState().clearSelection();
      }}
    >
      <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
        {tasks.map((task) => (
          <SortableCard
            key={task.taskNumber}
            task={task}
            projectPath={projectPath}
            chainMap={chainMap}
            isSettingUp={settingUpTaskNumbers?.has(task.taskNumber) ?? false}
            onRename={onRenameTask}
            onUpdateDescription={onUpdateDescription}
            onOpenTerminal={onOpenTerminal}
            onSwitchToTerminal={onSwitchToTerminal}
            onSelect={onSelect}
            sandboxAvailable={sandboxAvailable}
            hasEditorHook={hasEditorHook}
            onEditorHookConfigured={onEditorHookConfigured}
          />
        ))}
      </SortableContext>
      {status === 'todo' && tasks.length === 0 && (
        <div className="px-3 py-3 text-xs text-text-tertiary leading-relaxed">
          No tasks yet. Type a name below to add one.
        </div>
      )}
      {onAddTask && <KanbanAddInput onAdd={onAddTask} />}
    </KanbanColumnView>
  );
}

// ── Sortable wrapper ─────────────────────────────────────────────────

function SortableCard({
  task,
  projectPath,
  chainMap,
  isSettingUp,
  onRename,
  onUpdateDescription,
  onOpenTerminal,
  onSwitchToTerminal,
  onSelect,
  sandboxAvailable,
  hasEditorHook,
  onEditorHookConfigured,
}: {
  task: TaskWithWorkspace;
  projectPath: string;
  chainMap?: Map<number, TaskChainInfo>;
  isSettingUp?: boolean;
  onRename: (taskNumber: number, newName: string) => void;
  onUpdateDescription: (taskNumber: number, description: string) => void;
  onOpenTerminal: (task: TaskWithWorkspace, sandboxed?: boolean) => void;
  onSwitchToTerminal: (ptyId: string) => void;
  onSelect: (taskNumber: number, event: MouseEvent) => void;
  sandboxAvailable?: boolean;
  hasEditorHook?: boolean;
  onEditorHookConfigured?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `task-${task.taskNumber}`,
    data: { task, type: 'card' },
  });
  const isSelected = useProjectStore((s) => s.selectedTaskNumbers.has(task.taskNumber));

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
        chainInfo={chainMap?.get(task.taskNumber)}
        chainMap={chainMap}
        isSettingUp={isSettingUp}
        isSelected={isSelected}
        onRename={onRename}
        onUpdateDescription={onUpdateDescription}
        onOpenTerminal={onOpenTerminal}
        onSwitchToTerminal={onSwitchToTerminal}
        onSelect={onSelect}
        sandboxAvailable={sandboxAvailable}
        hasEditorHook={hasEditorHook}
        onEditorHookConfigured={onEditorHookConfigured}
      />
    </div>
  );
}
