/**
 * Turns the stores into the rows the mod+K switcher ranks.
 *
 * The rule this rests on: **a task is one row, always**. Split by state, the
 * same task is absent (no worktree yet), under Tasks (worktree, no shell), or
 * under Terminals wearing whatever label its agent set via OSC (shell running)
 * — so searching for it turns up a different thing, a differently-named thing,
 * or nothing, depending on state the user wasn't thinking about. The row is the
 * task; its state only decides what Enter does:
 *
 *   live terminal  →  focus it
 *   worktree only  →  open a plain shell there
 *   neither        →  create the worktree, then open a plain shell there
 *
 * Terminals list on their own only when they aren't a task's shell. Runners are
 * panels on a parent card and never list at all.
 */

import type { ActiveSession, Project, PullRequestSummary, SandboxProviderId, TaskWithWorkspace } from '../../types';
import type { TerminalDisplayState } from '../../stores/terminalStore';
import type { SearchField } from '../../utils/paletteScore';
import { formatAge } from '../../utils/formatDate';
import { STATUS_LABELS } from '../kanban/taskMenu';
import { activateTask, focusTerminal, selectProject, TASK_OPEN_LABEL } from '../navigation';
import { openPullRequestInPanel } from '../../services/githubTaskActions';
import { projectKey, pullKey, taskKey, terminalFrecencyKey, terminalKey } from '../../utils/paletteFrecency';

export type PaletteKind = 'terminal' | 'project' | 'task' | 'pull';

export const KIND_LABEL: Record<PaletteKind, string> = {
  terminal: 'Terminals',
  project: 'Projects',
  task: 'Tasks',
  pull: 'Pull requests',
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
  /** Set on pull request rows — the number is what you scan for and type. */
  prNumber?: number;
  tags?: string[];
  /** Right-aligned, dim. */
  meta?: string;
  dimmed?: boolean;
  /** Present when a live shell backs the row; renders as the leading dot. */
  status?: { summaryType: string; sandboxProvider?: SandboxProviderId };
  /**
   * Id of the task row this one hangs under. Set on a task's live shells, which
   * render as branch children the way they do on a kanban card. Ranking scores
   * parents only and re-attaches children afterwards, so a branch never drifts
   * away from its task.
   */
  parentId?: string;
  /** Which corner glyph the branch draws. */
  branch?: 'mid' | 'last';
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
  /**
   * Open pull requests for the active project, when the GitHub flag is on and
   * the inbox has already loaded. Absent otherwise — the palette never triggers
   * a fetch of its own, it paints from what is cached.
   */
  pullRequests?: PullRequestSummary[];
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

function taskFields(task: TaskWithWorkspace, project: Project, live: LiveTerminal[]): SearchField[] {
  const fields: SearchField[] = [
    { key: 'name', text: task.name || 'Untitled', weight: 1 },
    // Both forms, so "t-517" and "517" are each an exact hit rather than a
    // scattered subsequence of the name.
    { key: 'number', text: `T-${task.taskNumber}`, weight: 1 },
    { key: 'number', text: String(task.taskNumber), weight: 0.9 },
    { key: 'project', text: project.name, weight: 0.5 },
    { key: 'status', text: task.status, weight: 0.4 },
    { key: 'status', text: STATUS_LABELS[task.status] ?? task.status, weight: 0.4 },
  ];
  if (task.branch) fields.push({ key: 'branch', text: task.branch, weight: 0.7 });
  if (task.prompt) fields.push({ key: 'prompt', text: task.prompt, weight: 0.3 });
  // The task owns its shells' rows now, so it has to be findable by what they
  // are called — otherwise searching "claude" would match nothing.
  for (const terminal of live) fields.push({ key: 'terminal', text: terminal.label, weight: 0.8 });
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

  // Every live shell a task owns, in stack order. They render as that task's
  // branch children rather than as terminals in their own right.
  const liveByTask = new Map<string, LiveTerminal[]>();
  for (const terminal of terminals) {
    if (terminal.taskId == null) continue;
    const key = `${terminal.projectPath}#${terminal.taskId}`;
    const existing = liveByTask.get(key);
    if (existing) existing.push(terminal);
    else liveByTask.set(key, [terminal]);
  }

  const items: PaletteItem[] = [];
  const push = (item: Omit<PaletteItem, 'order'>) => items.push({ ...item, order: items.length });

  // ── Terminals ──
  // A task's shells hang off its row instead. The exception is a shell whose
  // task isn't in the cache (an unregistered project, a task deleted under a
  // running shell): without this it would vanish entirely.
  for (const terminal of terminals) {
    const project = projectByPath.get(terminal.projectPath);
    const key = terminalFrecencyKey(terminal.ptyId, terminal, input.taskCacheByProject);
    if (key !== terminalKey(terminal.ptyId)) continue;

    push({
      id: key,
      key,
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
    // Home-relative, matching the title bar: the context column is fixed-width
    // and an absolute path would spend most of it on /Users/<name>. Searched in
    // this form too — the match's ranges index the string the row renders, so
    // scoring the full path here would highlight the wrong characters.
    const displayPath = project.path.replace(/^\/Users\/[^/]+/, '~');
    push({
      id: projectKey(project.path),
      key: projectKey(project.path),
      kind: 'project',
      title: project.name,
      context: displayPath,
      fields: [
        { key: 'name', text: project.name, weight: 1 },
        { key: 'path', text: displayPath, weight: 0.6 },
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
    const live = liveByTask.get(`${project.path}#${task.taskNumber}`) ?? [];
    const first = live[0];
    const openable = task.worktreePath && task.branch;
    const status = STATUS_LABELS[task.status] ?? task.status;
    const taskId = taskKey(project.path, task.taskNumber);

    push({
      id: taskId,
      key: taskId,
      kind: 'task',
      title: task.name || 'Untitled',
      context: project.name,
      fields: taskFields(task, project, live),
      project,
      taskNumber: task.taskNumber,
      tags: first?.tags,
      // Compact age, not "3 days ago": the meta column is fixed-width so the
      // ages line up, and the long form would truncate.
      meta: `${status} · ${formatAge((Date.now() - new Date(task.createdAt).getTime()) / 1000)}`,
      // No status dot: the shells carry their own, on their branch rows.
      action: TASK_OPEN_LABEL[first ? 'focus' : openable ? 'open' : 'start'],
      // Shared with the GitHub panel's issue rows, so "take me to the work on
      // this" means the same thing wherever it is offered.
      run: () => void activateTask(project, task, first?.ptyId),
    });

    // The task's shells, drawn as branches off its row the way a kanban card
    // draws them. Each is its own target, so a task running several agents is
    // navigable rather than collapsing to whichever one sorted first.
    live.forEach((terminal, i) => {
      push({
        id: terminalKey(terminal.ptyId),
        key: taskId,
        kind: 'terminal',
        title: terminal.label,
        context: '',
        fields: [],
        project,
        parentId: taskId,
        branch: i === live.length - 1 ? 'last' : 'mid',
        status: { summaryType: terminal.summaryType, sandboxProvider: terminal.sandboxProvider },
        action: 'Focus terminal',
        run: () => void focusTerminal(terminal.ptyId, terminal.projectPath),
      });
    });
  }

  // ── Pull requests ──
  // Navigation only: Enter shows the PR in the project panel. Nothing here
  // creates a worktree or writes to GitHub, matching the rest of the switcher.
  // A PR already checked out as a task is skipped — that task row is the one
  // row for it, and listing both would be the duplicate-identity problem the
  // task rows above exist to avoid.
  if (input.activeProjectPath && input.pullRequests?.length) {
    const project = projectByPath.get(input.activeProjectPath);
    const projectPath = input.activeProjectPath;
    const linkedPrNumbers = new Set(
      (input.taskCacheByProject[projectPath] ?? []).map((t) => t.githubPrNumber).filter((n): n is number => n != null),
    );

    for (const pr of input.pullRequests) {
      if (linkedPrNumbers.has(pr.number)) continue;
      push({
        id: pullKey(projectPath, pr.number),
        key: pullKey(projectPath, pr.number),
        kind: 'pull',
        title: pr.title,
        context: project?.name ?? projectPath,
        fields: [
          { key: 'title', text: pr.title, weight: 1 },
          // Both forms, so "#42" and "42" each hit exactly rather than
          // scattering as a subsequence of the title.
          { key: 'number', text: `#${pr.number}`, weight: 1 },
          { key: 'number', text: String(pr.number), weight: 0.9 },
          { key: 'author', text: pr.author, weight: 0.6 },
          { key: 'branch', text: pr.headRefName, weight: 0.7 },
          { key: 'project', text: project?.name ?? projectPath, weight: 0.5 },
        ],
        project,
        prNumber: pr.number,
        meta: pr.reviewRequested && !pr.isMine ? 'needs review' : pr.isMine ? 'yours' : undefined,
        action: 'Open pull request',
        run: () => openPullRequestInPanel(projectPath, pr.number),
      });
    }
  }

  return items;
}
