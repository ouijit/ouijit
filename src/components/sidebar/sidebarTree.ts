import type { TaskStatus, TaskWithWorkspace } from '../../types';
import type { TerminalDisplayState } from '../../stores/terminalDisplay';

export const STAGES: TaskStatus[] = ['todo', 'in_progress', 'in_review', 'done'];

export interface TaskGroup {
  key: string;
  projectPath: string;
  taskId: number;
  /** Missing while the project's tasks are still loading, or once the task is deleted. */
  task: TaskWithWorkspace | undefined;
  /** Most recently used first. */
  ptyIds: string[];
}

export interface Grouped {
  tasks: TaskGroup[];
  shells: string[];
}

/**
 * The tasks these terminals belong to, in board order: by column, then by
 * their place in it. `projectOrder` puts tasks from several projects in the
 * sidebar's order first.
 */
export function groupByTask(
  ptyIds: string[],
  displays: Record<string, TerminalDisplayState>,
  tasksByProject: Record<string, TaskWithWorkspace[]>,
  projectOrder: string[] = [],
): Grouped {
  const groups = new Map<string, TaskGroup>();
  const shells: string[] = [];
  for (const ptyId of ptyIds) {
    const display = displays[ptyId];
    if (!display) continue;
    if (display.taskId == null) {
      shells.push(ptyId);
      continue;
    }
    const key = `${display.projectPath}#${display.taskId}`;
    const group = groups.get(key);
    if (group) group.ptyIds.push(ptyId);
    else
      groups.set(key, {
        key,
        projectPath: display.projectPath,
        taskId: display.taskId,
        task: tasksByProject[display.projectPath]?.find((t) => t.taskNumber === display.taskId),
        ptyIds: [ptyId],
      });
  }

  const projectRank = (path: string) => {
    const i = projectOrder.indexOf(path);
    return i < 0 ? projectOrder.length : i;
  };
  const stageRank = (task: TaskWithWorkspace | undefined) => (task ? STAGES.indexOf(task.status) : STAGES.length);
  const tasks = [...groups.values()].sort(
    (a, b) =>
      projectRank(a.projectPath) - projectRank(b.projectPath) ||
      stageRank(a.task) - stageRank(b.task) ||
      (a.task?.order ?? 0) - (b.task?.order ?? 0) ||
      a.taskId - b.taskId,
  );
  return {
    tasks,
    shells: shells.sort((a, b) => projectRank(displays[a].projectPath) - projectRank(displays[b].projectPath)),
  };
}

export interface TagGroup {
  key: string;
  /** Null for the terminals with no tag. */
  tag: string | null;
  ptyIds: string[];
}

/** Every tag in use, alphabetically, then the untagged. A terminal is under each of its tags. */
export function groupByTag(ptyIds: string[], displays: Record<string, TerminalDisplayState>): TagGroup[] {
  const tagged = new Map<string, TagGroup>();
  const untagged: string[] = [];
  for (const ptyId of ptyIds) {
    const tags = displays[ptyId]?.tags ?? [];
    if (tags.length === 0) untagged.push(ptyId);
    for (const tag of tags) {
      const key = `tag:${tag.toLowerCase()}`;
      const group = tagged.get(key) ?? tagged.set(key, { key, tag, ptyIds: [] }).get(key)!;
      if (!group.ptyIds.includes(ptyId)) group.ptyIds.push(ptyId);
    }
  }
  const groups = [...tagged.values()].sort((a, b) => a.key.localeCompare(b.key));
  if (untagged.length > 0) groups.push({ key: 'tag:', tag: null, ptyIds: untagged });
  return groups;
}

/** The raw comparison, so the terminal on screen stays listed until it is left. */
export function waitingFor(order: string[], displays: Record<string, TerminalDisplayState>): string[] {
  return order
    .filter((id) => {
      const d = displays[id];
      return d !== undefined && !d.isLoading && d.status === 'ready' && d.statusSince > d.lastViewedAt;
    })
    .sort((a, b) => displays[a].statusSince - displays[b].statusSince);
}

export function formatSince(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}
