/**
 * Home view's "pick up where you left off" surface — replaces the empty
 * "no active terminals" state with a list of recent open tasks across all
 * projects. Single-click opens that task's terminal in its project; Cmd/Ctrl-
 * click toggles selection for bulk opening.
 */

import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../stores/appStore';
import { useProjectStore } from '../stores/projectStore';
import { addProjectTerminal } from './terminal/terminalActions';
import { stringToColor, getInitials } from '../utils/projectIcon';
import { formatRelativeTime } from '../utils/formatDate';
import type { Project, TaskWithWorkspace } from '../types';

const MAX_TASKS = 8;
const STATUS_LABEL: Record<string, string> = {
  todo: 'to do',
  in_progress: 'in progress',
  in_review: 'to review',
};

interface RecentTask extends TaskWithWorkspace {
  project: Project;
}

function taskKey(task: RecentTask): string {
  return `${task.project.path}#${task.taskNumber}`;
}

async function openTaskTerminal(task: RecentTask): Promise<void> {
  if (task.worktreePath && task.branch) {
    await addProjectTerminal(task.project.path, undefined, {
      existingWorktree: { path: task.worktreePath, branch: task.branch, createdAt: task.createdAt },
      taskId: task.taskNumber,
    });
    return;
  }

  // No worktree yet — start the task (creates worktree, flips to in_progress).
  const result = await window.api.task.start(task.project.path, task.taskNumber);
  if (!result.success || !result.worktreePath) {
    useProjectStore.getState().addToast(result.error || `Failed to open T-${task.taskNumber}`, 'error');
    return;
  }
  await addProjectTerminal(task.project.path, undefined, {
    existingWorktree: {
      path: result.worktreePath,
      branch: result.task?.branch || '',
      createdAt: task.createdAt,
    },
    taskId: task.taskNumber,
    skipAutoHook: true,
  });
}

interface RecentTasksPanelProps {
  projects: Project[];
}

export function RecentTasksPanel({ projects }: RecentTasksPanelProps) {
  const [recents, setRecents] = useState<RecentTask[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      projects.map((project) =>
        window.api.task
          .getAll(project.path)
          .then((tasks) => tasks.map((t) => ({ ...t, project })))
          .catch(() => [] as RecentTask[]),
      ),
    ).then((arrays) => {
      if (cancelled) return;
      const all = arrays
        .flat()
        .filter((t) => t.status !== 'done')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, MAX_TASKS);
      setRecents(all);
    });
    return () => {
      cancelled = true;
    };
  }, [projects]);

  if (recents === null) return null;
  if (recents.length === 0) return <EmptyHint />;

  const allSelected = selected.size === recents.length;

  const toggleSelected = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(recents.map(taskKey)));
  };

  const clearSelection = () => setSelected(new Set());

  // Spawn terminal(s) first so they're registered in the store before
  // ProjectViewReact mounts. That view runs reconnectOrphanedSessions on
  // projectPath change and force-shows the kanban if no terminals are
  // registered yet — which would defeat our kanban-hidden navigation.
  const navigateToProjectTerminals = (project: Project) => {
    useAppStore.getState().navigateToProject(project.path, project);
    const store = useProjectStore.getState();
    store.setActivePanel('terminals');
    store.setKanbanVisible(false);
  };

  const openAndNavigate = async (task: RecentTask) => {
    await openTaskTerminal(task);
    navigateToProjectTerminals(task.project);
  };

  const openSelection = async () => {
    const tasks = recents.filter((t) => selected.has(taskKey(t)));
    if (tasks.length === 0) return;
    await Promise.all(tasks.map((t) => openTaskTerminal(t)));
    // Navigate to the first selected task's project (most recent). Terminals
    // for tasks in other projects appear when the user switches to those.
    navigateToProjectTerminals(tasks[0].project);
    clearSelection();
  };

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center overflow-hidden">
      <div
        className="w-full max-w-[36rem] flex flex-col rounded-[14px] border border-black/60 glass-bevel relative overflow-hidden"
        style={{ background: 'var(--color-terminal-bg)', maxHeight: '100%' }}
      >
        <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3 shrink-0 border-b border-white/[0.06]">
          <span className="text-[11px] uppercase tracking-wider text-text-tertiary">Pick up where you left off</span>
          <button
            type="button"
            onClick={toggleAll}
            className="text-[11px] text-text-tertiary hover:text-text-secondary transition-colors duration-100 [-webkit-app-region:no-drag]"
          >
            {allSelected ? 'Deselect all' : `Select all (${recents.length})`}
          </button>
        </div>
        <ul className="flex flex-col overflow-y-auto min-h-0 settings-scrollable divide-y divide-white/[0.04]">
          {recents.map((task) => {
            const key = taskKey(task);
            return (
              <RecentTaskRow
                key={key}
                task={task}
                selected={selected.has(key)}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey) {
                    toggleSelected(key);
                  } else {
                    openAndNavigate(task);
                  }
                }}
                onToggle={() => toggleSelected(key)}
              />
            );
          })}
        </ul>
        {selected.size > 0 && (
          <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-white/[0.06] shrink-0">
            <span className="text-xs text-text-tertiary tabular-nums">
              <span className="text-text-secondary">{selected.size}</span> selected
            </span>
            <div className="flex items-center gap-2 [-webkit-app-region:no-drag]">
              <button
                type="button"
                onClick={clearSelection}
                className="px-3 py-1.5 text-xs text-text-secondary rounded-full hover:bg-white/[0.04] transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={openSelection}
                className="px-3 py-1.5 text-xs font-medium text-white bg-accent rounded-full hover:bg-accent-hover active:scale-[0.98] transition-all duration-150"
              >
                Open {selected.size} task{selected.size === 1 ? '' : 's'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyHint() {
  const isMac = useMemo(() => navigator.platform.toLowerCase().includes('mac'), []);
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-text-tertiary rounded-[14px] border border-dashed border-white/10"
      style={{ background: 'var(--color-terminal-bg)' }}
    >
      <div className="text-sm">No tasks yet.</div>
      <div className="flex items-center gap-2 text-xs">
        <span className="font-mono text-[13px]">{isMac ? '⌘ I' : 'Ctrl+I'}</span>
        <span>to open a terminal</span>
      </div>
    </div>
  );
}

interface RecentTaskRowProps {
  task: RecentTask;
  selected: boolean;
  onClick: (e: React.MouseEvent) => void;
  onToggle: () => void;
}

function RecentTaskRow({ task, selected, onClick, onToggle }: RecentTaskRowProps) {
  const [checkboxHover, setCheckboxHover] = useState(false);
  const showOpenHint = !selected && !checkboxHover;
  const showSelectHint = checkboxHover;
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick(e as unknown as React.MouseEvent);
          }
        }}
        className={`group w-full flex items-center gap-3 pl-3 pr-5 py-2.5 text-left transition-colors duration-100 [-webkit-app-region:no-drag] cursor-default ${
          selected ? 'bg-accent/15 hover:bg-accent/20' : 'hover:bg-white/[0.03]'
        }`}
      >
        <Checkbox
          checked={selected}
          onChange={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          onPointerEnter={() => setCheckboxHover(true)}
          onPointerLeave={() => setCheckboxHover(false)}
        />
        <ProjectThumb project={task.project} />
        <div className="flex flex-col min-w-0 flex-1 gap-0.5">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono text-[11px] text-text-tertiary tabular-nums shrink-0">T-{task.taskNumber}</span>
            <span className="text-sm text-text-primary truncate">{task.name || 'Untitled'}</span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-text-tertiary min-w-0">
            <span className="truncate">{task.project.name}</span>
            <span aria-hidden>·</span>
            <span className="shrink-0">{STATUS_LABEL[task.status] ?? task.status}</span>
            <span aria-hidden>·</span>
            <span className="shrink-0">{formatRelativeTime(new Date(task.createdAt))}</span>
          </div>
        </div>
        <div className="shrink-0 ml-3 text-[11px] text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity duration-100">
          {showOpenHint && 'Open terminal →'}
          {showSelectHint && (selected ? 'Deselect' : 'Add to selection')}
          {!showOpenHint && !showSelectHint && (selected ? 'Open terminal →' : '')}
        </div>
      </div>
    </li>
  );
}

interface CheckboxProps {
  checked: boolean;
  onChange: (e: React.MouseEvent) => void;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}

function Checkbox({ checked, onChange, onPointerEnter, onPointerLeave }: CheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={checked ? 'Deselect task' : 'Select task'}
      onClick={onChange}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      className="shrink-0 w-7 h-7 -ml-1.5 rounded-md flex items-center justify-center transition-colors duration-100 hover:bg-white/[0.08] active:bg-white/[0.12] [-webkit-app-region:no-drag]"
    >
      <span
        className={`w-[15px] h-[15px] rounded border transition-all duration-100 flex items-center justify-center ${
          checked
            ? 'bg-accent border-accent'
            : 'border-white/30 bg-white/[0.04] group-hover:border-white/50 group-hover:bg-white/[0.06]'
        }`}
      >
        {checked && (
          <svg viewBox="0 0 12 12" className="w-3 h-3 text-white" aria-hidden>
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M2.5 6.5L5 9l4.5-5"
            />
          </svg>
        )}
      </span>
    </button>
  );
}

function ProjectThumb({ project }: { project: Project }) {
  return (
    <div className="w-7 h-7 overflow-hidden rounded-md shrink-0">
      {project.iconDataUrl ? (
        <img src={project.iconDataUrl} alt="" className="w-full h-full object-cover" draggable={false} />
      ) : (
        <div
          className="w-full h-full flex items-center justify-center text-xs font-bold text-white"
          style={{
            backgroundColor: stringToColor(project.name),
            textShadow: '0 1px 2px rgba(0, 0, 0, 0.2)',
          }}
        >
          {getInitials(project.name)}
        </div>
      )}
    </div>
  );
}
