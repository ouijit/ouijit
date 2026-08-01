/**
 * Turns the stores into the rows the mod+K switcher ranks.
 *
 * The one rule worth stating: **a task is one row, always**. Earlier the same
 * task could be absent (no worktree yet), listed under Tasks (worktree, no
 * shell), or listed under Terminals wearing whatever label its agent had set
 * via OSC (shell running). Searching for it therefore turned up a different
 * thing, a differently-named thing, or nothing, depending on state the user
 * wasn't thinking about. Now the row is the task; its state only decides what
 * Enter does:
 *
 *   live terminal  →  focus it
 *   worktree only  →  open a plain shell there
 *   neither        →  create the worktree, then open a plain shell there
 *
 * Terminals list on their own only when they aren't a task's shell. Runners are
 * panels on a parent card and never list at all.
 */

import type { ActiveSession, Project, SandboxProviderId, TaskWithWorkspace } from '../../types';
import type { TerminalDisplayState } from '../../stores/terminalStore';
import type { SearchField } from '../../utils/paletteScore';
import { formatRelativeTime } from '../../utils/formatDate';
import { focusTerminal, openTaskWorktree, selectProject, startTaskWorktree } from '../navigation';

export type PaletteKind = 'terminal' | 'project' | 'task';

export const KIND_LABEL: Record<PaletteKind, string> = {
  terminal: 'Terminals',
  project: 'Projects',
  task: 'Tasks',
};

const STATUS_LABEL: Record<string, string> = {
  todo: 'to do',
  in_progress: 'in progress',
  in_review: 'to review',
  done: 'done',
};

export interface PaletteItem {
  id: string;
  /**
   * Frecency identity. Deliberately not the ptyId for task rows — a task keeps
   * one key across every shell it ever spawns, so what you learned about it
   * survives the worktree being closed and reopened.
   */
  key: string;
  kind: PaletteKind;
  /** Highlighted when the query matched it. */
  title: string;
  /** Owning project (path, for a project row). Dimmed, after the title. */
  context: string;
  fields: SearchField[];
  project?: Project;
  taskNumber?: number;
  tags?: string[];
  /** Right-aligned, dim. */
  meta?: string;
  dimmed?: boolean;
  /** Present when a live shell backs the row; renders as the leading dot. */
  status?: { summaryType: string; sandboxProvider?: SandboxProviderId };
  /** What Enter does, named in the footer as the selection moves. */
  action: string;
  /** Position in the no-query browse order; the final ranking tiebreak. */
  order: number;
  run: () => void;
}

export interface PaletteInput {
  projects: Project[];
  activeProjectPath: string | null;
  terminalsByProject: Record<string, string[]>;
  displayStates: Record<string, TerminalDisplayState>;
  sessions: ActiveSession[];
  taskCacheByProject: Record<string, TaskWithWorkspace[]>;
}

/** One live, switchable shell, from either source. */
interface LiveTerminal {
  ptyId: string;
  projectPath: string;
  label: string;
  taskId: number | null;
  tags: string[];
  branch: string | null;
  exited: boolean;
  summaryType: string;
  sandboxProvider?: SandboxProviderId;
  /** Active project first, then hydrated, then merely live. */
  rank: number;
}

/**
 * Live shells, store first.
 *
 * The store has the rich display state but only covers projects this renderer
 * has hydrated; `getActiveSessions` is authoritative for the rest. Loading slots
 * have no process behind them yet, and runners are panels on a card.
 */
function collectTerminals(input: PaletteInput): LiveTerminal[] {
  const terminals: LiveTerminal[] = [];
  const seen = new Set<string>();

  for (const [projectPath, ptyIds] of Object.entries(input.terminalsByProject)) {
    for (const ptyId of ptyIds) {
      const display = input.displayStates[ptyId];
      if (!display || display.isLoading) continue;
      seen.add(ptyId);
      terminals.push({
        ptyId,
        projectPath,
        label: display.label || 'Terminal',
        taskId: display.taskId,
        tags: display.tags,
        branch: display.worktreeBranch,
        exited: display.exited,
        summaryType: display.summaryType,
        sandboxProvider: display.sandboxProvider,
        rank: projectPath === input.activeProjectPath ? 0 : 1,
      });
    }
  }

  for (const session of input.sessions) {
    if (session.isRunner || seen.has(session.ptyId)) continue;
    seen.add(session.ptyId);
    terminals.push({
      ptyId: session.ptyId,
      projectPath: session.projectPath,
      label: session.label || 'Terminal',
      taskId: session.taskId ?? null,
      tags: [],
      branch: null,
      exited: false,
      // Not hydrated, so there's no live summary yet — the card shows the real
      // one once it reconnects.
      summaryType: 'ready',
      sandboxProvider: session.sandboxProvider,
      rank: session.projectPath === input.activeProjectPath ? 0 : 2,
    });
  }

  return terminals.sort((a, b) => a.rank - b.rank);
}

function taskFields(task: TaskWithWorkspace, project: Project): SearchField[] {
  const fields: SearchField[] = [
    { key: 'name', text: task.name || 'Untitled', weight: 1 },
    // Both forms, so "t-517" and "517" are each an exact hit rather than a
    // scattered subsequence of the name.
    { key: 'number', text: `T-${task.taskNumber}`, weight: 1 },
    { key: 'number', text: String(task.taskNumber), weight: 0.9 },
    { key: 'project', text: project.name, weight: 0.5 },
    { key: 'status', text: task.status, weight: 0.4 },
    { key: 'status', text: STATUS_LABEL[task.status] ?? task.status, weight: 0.4 },
  ];
  if (task.branch) fields.push({ key: 'branch', text: task.branch, weight: 0.7 });
  if (task.prompt) fields.push({ key: 'prompt', text: task.prompt, weight: 0.3 });
  return fields;
}

function terminalFields(terminal: LiveTerminal, project: Project | undefined): SearchField[] {
  const fields: SearchField[] = [{ key: 'label', text: terminal.label, weight: 1 }];
  for (const tag of terminal.tags) fields.push({ key: 'tag', text: tag, weight: 0.8 });
  if (terminal.branch) fields.push({ key: 'branch', text: terminal.branch, weight: 0.7 });
  fields.push({ key: 'project', text: project?.name ?? terminal.projectPath, weight: 0.5 });
  return fields;
}

export function buildPaletteItems(input: PaletteInput): PaletteItem[] {
  const projectByPath = new Map(input.projects.map((p) => [p.path, p]));
  const terminals = collectTerminals(input);

  // First live shell per task. A task with several shells focuses the one that
  // sorted highest, matching what its card would bring forward.
  const liveByTask = new Map<string, LiveTerminal>();
  for (const terminal of terminals) {
    if (terminal.taskId == null) continue;
    const key = `${terminal.projectPath}#${terminal.taskId}`;
    if (!liveByTask.has(key)) liveByTask.set(key, terminal);
  }

  const items: PaletteItem[] = [];
  const push = (item: Omit<PaletteItem, 'order'>) => items.push({ ...item, order: items.length });

  // ── Terminals ──
  // A task's shell is represented by its task row instead. The exception is a
  // shell whose task isn't in the cache (an unregistered project, a task
  // deleted under a running shell): without this it would vanish entirely.
  for (const terminal of terminals) {
    const project = projectByPath.get(terminal.projectPath);
    const taskKey = terminal.taskId != null ? `${terminal.projectPath}#${terminal.taskId}` : null;
    const taskExists =
      taskKey != null &&
      (input.taskCacheByProject[terminal.projectPath] ?? []).some((t) => t.taskNumber === terminal.taskId);
    if (taskExists && liveByTask.get(taskKey as string)?.ptyId === terminal.ptyId) continue;

    push({
      id: `terminal:${terminal.ptyId}`,
      key: `terminal:${terminal.ptyId}`,
      kind: 'terminal',
      title: terminal.label,
      context: project?.name ?? terminal.projectPath,
      fields: terminalFields(terminal, project),
      project,
      taskNumber: terminal.taskId ?? undefined,
      tags: terminal.tags,
      meta: terminal.exited ? 'exited' : undefined,
      dimmed: terminal.exited,
      status: { summaryType: terminal.summaryType, sandboxProvider: terminal.sandboxProvider },
      action: 'Focus terminal',
      run: () => void focusTerminal(terminal.ptyId, terminal.projectPath),
    });
  }

  // ── Projects ──
  for (const project of input.projects) {
    push({
      id: `project:${project.path}`,
      key: `project:${project.path}`,
      kind: 'project',
      title: project.name,
      context: project.path,
      fields: [
        { key: 'name', text: project.name, weight: 1 },
        { key: 'path', text: project.path, weight: 0.6 },
      ],
      project,
      action: 'Switch project',
      run: () => void selectProject(project.path, project),
    });
  }

  // ── Tasks ──
  const taskRows: { task: TaskWithWorkspace; project: Project }[] = [];
  for (const [projectPath, tasks] of Object.entries(input.taskCacheByProject)) {
    const project = projectByPath.get(projectPath);
    if (!project) continue;
    for (const task of tasks) taskRows.push({ task, project });
  }
  taskRows.sort((a, b) => b.task.createdAt.localeCompare(a.task.createdAt));

  for (const { task, project } of taskRows) {
    const live = liveByTask.get(`${project.path}#${task.taskNumber}`);
    const openable = task.worktreePath && task.branch;
    const status = STATUS_LABEL[task.status] ?? task.status;

    push({
      id: `task:${project.path}#${task.taskNumber}`,
      key: `task:${project.path}#${task.taskNumber}`,
      kind: 'task',
      title: task.name || 'Untitled',
      context: project.name,
      fields: taskFields(task, project),
      project,
      taskNumber: task.taskNumber,
      tags: live?.tags,
      meta: `${status} · ${formatRelativeTime(new Date(task.createdAt))}`,
      status: live ? { summaryType: live.summaryType, sandboxProvider: live.sandboxProvider } : undefined,
      action: live ? 'Focus terminal' : openable ? 'Open worktree' : 'Start task',
      run: () => {
        if (live) {
          void focusTerminal(live.ptyId, live.projectPath);
        } else if (openable) {
          void openTaskWorktree({
            project,
            taskNumber: task.taskNumber,
            worktreePath: task.worktreePath as string,
            branch: task.branch as string,
            createdAt: task.createdAt,
          });
        } else {
          void startTaskWorktree(project, task.taskNumber, task.createdAt);
        }
      },
    });
  }

  return items;
}
