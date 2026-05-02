/**
 * Home view's "pick up where you left off" surface — replaces the empty
 * "no active terminals" state with a list of recent open tasks across all
 * projects. Clicking a row jumps into that project's kanban.
 */

import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../stores/appStore';
import { useProjectStore } from '../stores/projectStore';
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

interface RecentTasksPanelProps {
  projects: Project[];
}

export function RecentTasksPanel({ projects }: RecentTasksPanelProps) {
  const [recents, setRecents] = useState<RecentTask[] | null>(null);

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

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center px-6 py-6 overflow-hidden">
      <div
        className="w-full max-w-[36rem] flex flex-col rounded-[14px] border border-black/60 glass-bevel relative overflow-hidden"
        style={{ background: 'var(--color-terminal-bg)', maxHeight: '100%' }}
      >
        <div className="px-5 pt-4 pb-3 text-[11px] uppercase tracking-wider text-text-tertiary shrink-0 border-b border-white/[0.06]">
          Pick up where you left off
        </div>
        <ul className="flex flex-col overflow-y-auto min-h-0 settings-scrollable divide-y divide-white/[0.04]">
          {recents.map((task) => (
            <RecentTaskRow key={`${task.project.path}#${task.taskNumber}`} task={task} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function EmptyHint() {
  const isMac = useMemo(() => navigator.platform.toLowerCase().includes('mac'), []);
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-text-tertiary rounded-[14px] border border-dashed border-white/10">
      <div className="text-sm">No tasks yet.</div>
      <div className="flex items-center gap-2 text-xs">
        <span className="font-mono text-[13px]">{isMac ? '⌘ I' : 'Ctrl+I'}</span>
        <span>to open a terminal</span>
      </div>
    </div>
  );
}

function RecentTaskRow({ task }: { task: RecentTask }) {
  const onClick = () => {
    useAppStore.getState().navigateToProject(task.project.path, task.project);
    useProjectStore.getState().setKanbanVisible(true);
  };

  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="w-full flex items-center gap-3 px-5 py-2.5 text-left transition-colors duration-100 hover:bg-white/[0.03] [-webkit-app-region:no-drag]"
      >
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
      </button>
    </li>
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
