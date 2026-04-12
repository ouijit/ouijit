import { useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useProjectStore } from '../../stores/projectStore';
import type { TaskWithWorkspace, TaskStatus } from '../../types';
import { Icon } from '../terminal/Icon';

interface BulkActionBarProps {
  projectPath: string;
  onOpenTerminal: (task: TaskWithWorkspace, sandboxed?: boolean) => void;
}

export function BulkActionBar({ projectPath, onOpenTerminal }: BulkActionBarProps) {
  const selectedTaskNumbers = useProjectStore((s) => s.selectedTaskNumbers);
  const tasks = useProjectStore((s) => s.tasks);
  const count = selectedTaskNumbers.size;

  const selectedTasks = tasks.filter((t) => selectedTaskNumbers.has(t.taskNumber));

  // Determine which statuses ALL selected tasks share (to hide that button)
  const allSameStatus =
    selectedTasks.length > 0 && selectedTasks.every((t) => t.status === selectedTasks[0].status)
      ? selectedTasks[0].status
      : null;

  const handleMoveToStatus = useCallback(
    async (status: TaskStatus) => {
      const selected = [...useProjectStore.getState().selectedTaskNumbers];
      await Promise.allSettled(selected.map((n) => window.api.task.setStatus(projectPath, n, status)));
      useProjectStore.getState().loadTasks(projectPath);
      useProjectStore.getState().clearSelection();
      const label = { todo: 'To Do', in_progress: 'In Progress', in_review: 'In Review', done: 'Done' }[status];
      useProjectStore.getState().addToast(`Moved ${selected.length} tasks to ${label}`, 'success');
    },
    [projectPath],
  );

  const handleDelete = useCallback(async () => {
    const store = useProjectStore.getState();
    const selected = [...store.selectedTaskNumbers];
    if (selected.length > 5) {
      store.addToast(`Delete ${selected.length} tasks?`, {
        type: 'info',
        persistent: true,
        actionLabel: 'Delete',
        onAction: async () => {
          const nums = [...useProjectStore.getState().selectedTaskNumbers];
          await Promise.allSettled(nums.map((n) => window.api.task.trash(projectPath, n)));
          useProjectStore.getState().loadTasks(projectPath);
          useProjectStore.getState().clearSelection();
          useProjectStore.getState().addToast(`Deleted ${nums.length} tasks`, 'success');
        },
      });
      return;
    }
    await Promise.allSettled(selected.map((n) => window.api.task.trash(projectPath, n)));
    useProjectStore.getState().loadTasks(projectPath);
    useProjectStore.getState().clearSelection();
    useProjectStore.getState().addToast(`Deleted ${selected.length} tasks`, 'success');
  }, [projectPath]);

  const handleOpenTerminals = useCallback(() => {
    const store = useProjectStore.getState();
    const selected = [...store.selectedTaskNumbers];
    const tasksToOpen = store.tasks.filter((t) => selected.includes(t.taskNumber));

    const doOpen = () => {
      for (const t of tasksToOpen) onOpenTerminal(t);
      useProjectStore.getState().clearSelection();
    };

    if (tasksToOpen.length > 3) {
      store.addToast(`Open ${tasksToOpen.length} terminals?`, {
        type: 'info',
        persistent: true,
        actionLabel: 'Open',
        onAction: doOpen,
      });
      return;
    }
    doOpen();
  }, [onOpenTerminal]);

  const bar = (
    <div
      className="fixed z-[200] flex items-center gap-1 px-3 py-2 whitespace-nowrap"
      style={{
        bottom: 56,
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(30, 30, 30, 0.95)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: 10,
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
      }}
    >
      <span className="text-xs font-medium text-text-secondary px-2 whitespace-nowrap">{count} selected</span>
      <Divider />
      {allSameStatus !== 'todo' && <ActionButton label="To Do" onClick={() => handleMoveToStatus('todo')} />}
      {allSameStatus !== 'in_progress' && (
        <ActionButton label="In Progress" onClick={() => handleMoveToStatus('in_progress')} />
      )}
      {allSameStatus !== 'in_review' && (
        <ActionButton label="In Review" onClick={() => handleMoveToStatus('in_review')} />
      )}
      {allSameStatus !== 'done' && <ActionButton label="Done" onClick={() => handleMoveToStatus('done')} />}
      <Divider />
      <ActionButton icon="terminal" label="Terminal" onClick={handleOpenTerminals} />
      <Divider />
      <ActionButton icon="trash" label="Delete" onClick={handleDelete} danger />
    </div>
  );

  return createPortal(bar, document.body);
}

function Divider() {
  return <div className="w-px h-4 mx-1" style={{ background: 'rgba(255, 255, 255, 0.1)' }} />;
}

function ActionButton({
  icon,
  label,
  onClick,
  danger,
}: {
  icon?: string;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border-none text-xs font-medium transition-colors duration-100 [&>svg]:w-3.5 [&>svg]:h-3.5 ${
        danger
          ? 'text-text-secondary bg-transparent hover:text-red-400 hover:bg-red-500/10'
          : 'text-text-secondary bg-transparent hover:text-text-primary hover:bg-white/[0.08]'
      }`}
      onClick={onClick}
    >
      {icon && <Icon name={icon} />}
      {label}
    </button>
  );
}
