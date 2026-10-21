/**
 * Shared navigation actions for the sidebar, the command palette, the board
 * and the recents panel.
 *
 * Nothing here feeds palette frecency. What the user ends up looking at is a
 * visit, and `visitTracker` reads that off the view itself.
 */

import type { Project, SandboxProviderId, TaskWithWorkspace, WorktreeInfo } from '../types';
import { useAppStore, type ProjectPage } from '../stores/appStore';
import { useProjectStore } from '../stores/projectStore';
import { loadTasks } from '../stores/projectDataStore';
import { stackMembers, stackOf, useTerminalStore } from '../stores/terminalStore';
import { useCanvasStore } from '../stores/canvasStore';
import { addProjectTerminal, reconnectOrphanedSessions } from './terminal/terminalActions';
import { makePlaceholderId, surfaceStartWarnings } from '../services/taskStartService';
import { terminalInstances } from './terminal/terminalRegistry';
import { ensureWorktree } from '../services/worktreeRecovery';

/** Tasks load first, so a board's first paint has its cards. */
export async function openProjectPage(path: string, page: ProjectPage): Promise<void> {
  if (page === 'board') await loadTasks(path);
  useAppStore.getState().openPage(path, page);
}

/** Back to the board or terminal stack the project last had, else its board. */
export async function openProject(path: string): Promise<void> {
  const view = useAppStore.getState().projectView(path);
  if (view?.kind === 'terminal') useAppStore.getState().select(view);
  else await openProjectPage(path, 'board');
}

function showTaskTerminals(projectPath: string, taskNumber: number): void {
  const [front] = stackMembers(useTerminalStore.getState(), stackOf({ ptyId: '', projectPath, taskId: taskNumber }));
  if (front) useAppStore.getState().showTerminal(front);
}

/** A shell in `projectPath`, shown once it spawns. */
export async function openShell(projectPath: string): Promise<void> {
  if (!(await addProjectTerminal(projectPath))) return;
  const [front] = useTerminalStore.getState().order;
  if (front) useAppStore.getState().showTerminal(front);
}

/** Fit and focus a terminal's xterm once React has had a frame to mount it. */
function focusXterm(ptyId: string): void {
  requestAnimationFrame(() => {
    const instance = terminalInstances.get(ptyId);
    if (!instance) return;
    instance.fit();
    instance.xterm.focus();
  });
}

/**
 * Brings a terminal to the front, reconnecting a session this renderer has not
 * hydrated yet. `reconnectOrphanedSessions` is idempotent, so this is safe for
 * registered projects too. `projectPath` is needed only for the unhydrated
 * case.
 */
export async function focusTerminal(
  ptyId: string,
  { projectPath, stack }: { projectPath?: string; stack?: string } = {},
): Promise<void> {
  let display = useTerminalStore.getState().displayStates[ptyId];
  if (!display) {
    if (!projectPath) return;
    await reconnectOrphanedSessions(projectPath);
    display = useTerminalStore.getState().displayStates[ptyId];
    if (!display) return;
  }

  const ownerPath = display.projectPath;
  useAppStore.getState().showTerminal(ptyId, stack);

  if (useProjectStore.getState().terminalLayout === 'canvas') {
    const canvas = useCanvasStore.getState().canvasByProject[ownerPath];
    if (canvas) {
      const nodes = canvas.nodes.map((node) => ({ ...node, selected: node.id === ptyId }));
      useCanvasStore.getState().loadCanvas(ownerPath, { ...canvas, nodes });
    }
  }

  focusXterm(ptyId);
}

export interface OpenTaskShellOptions {
  /**
   * `resume` relaunches the project's continue hook in the worktree — picking
   * the agent session back up. `shell` opens a plain shell. A task that has
   * never been started lands as a plain shell either way: `task.start` leaves
   * nothing to resume.
   */
  mode: 'resume' | 'shell';
  /** Never persisted on the task — passed straight to the spawn. */
  sandboxProvider?: SandboxProviderId;
  replaceLoadingId?: string;
}

/**
 * The worktree a task's actions run in: recovered when it has gone missing,
 * created when the task has never been started. `beginTask` behind
 * `task.start` creates the branch and worktree and moves a todo task to
 * in_progress; it runs no hook.
 *
 * Null means there is nothing to open — including when the user declined to
 * recover a missing worktree, in which case they have already been told why.
 */
export async function ensureTaskWorktree(projectPath: string, task: TaskWithWorkspace): Promise<WorktreeInfo | null> {
  if (task.branch) {
    const ensured = await ensureWorktree(projectPath, task);
    return ensured && { path: ensured.path, branch: ensured.branch, createdAt: task.createdAt };
  }

  const result = await window.api.task.start(projectPath, task.taskNumber);
  if (!result.success || !result.worktreePath) {
    useProjectStore.getState().addToast(result.error || `Failed to open T-${task.taskNumber}`, 'error');
    return null;
  }
  surfaceStartWarnings(result.warnings);
  void loadTasks(projectPath);
  return { path: result.worktreePath, branch: result.task?.branch || '', createdAt: task.createdAt };
}

/** Navigating to the shell it spawns is the caller's concern. */
export async function openTaskShell(
  projectPath: string,
  task: TaskWithWorkspace,
  options: OpenTaskShellOptions,
): Promise<boolean> {
  const skipAutoHook = options.mode === 'shell' || !task.branch;

  const worktree = await ensureTaskWorktree(projectPath, task);
  if (!worktree) return false;

  return addProjectTerminal(projectPath, undefined, {
    existingWorktree: worktree,
    taskId: task.taskNumber,
    skipAutoHook,
    sandboxProvider: options.sandboxProvider,
    replaceLoadingId: options.replaceLoadingId,
  });
}

/** Another terminal in a task's worktree, as the board opens one, shown in front of `stack` or its own. */
export async function openTaskTerminal(
  projectPath: string,
  task: TaskWithWorkspace,
  sandboxProvider?: SandboxProviderId,
  stack?: string,
): Promise<void> {
  if (!(await openTaskShell(projectPath, task, { mode: 'resume', sandboxProvider }))) return;
  const [front] = useTerminalStore.getState().order;
  if (front) useAppStore.getState().showTerminal(front, stack);
}

/** Lands on the first task that actually opened. */
export async function openTasks(
  tasks: { project: Project; task: TaskWithWorkspace }[],
  mode: OpenTaskShellOptions['mode'] = 'resume',
): Promise<void> {
  const opened = await Promise.all(tasks.map(({ project, task }) => openTaskShell(project.path, task, { mode })));
  const landing = tasks[opened.indexOf(true)];
  if (landing) showTaskTerminals(landing.project.path, landing.task.taskNumber);
}

/**
 * Creating a worktree takes long enough to see, so this borrows the kanban
 * drop's staging rather than awaiting it behind a closed palette: a loading slot
 * goes into the stack first and the view moves to it immediately, so the card is
 * on screen — with its chrome, in its final position — while git works. The real
 * terminal then takes that slot's place via `replaceLoadingId` instead of
 * appearing from nowhere once everything is ready.
 */
async function startTaskWorktree(project: Project, task: TaskWithWorkspace): Promise<void> {
  // A second Enter on a row whose start is still in flight would stage a
  // duplicate slot and race the first spawn.
  if (useProjectStore.getState().startingTaskNumbers.has(task.taskNumber)) return;

  const slotId = makePlaceholderId(task.taskNumber);
  useProjectStore.getState().markTaskStarting(task.taskNumber);
  useTerminalStore
    .getState()
    .addTerminal(project.path, slotId, { label: task.name || 'Untitled', taskId: task.taskNumber, isLoading: true });

  try {
    useAppStore.getState().showTerminal(slotId);
    await openTaskShell(project.path, task, { mode: 'shell', replaceLoadingId: slotId });
  } finally {
    useProjectStore.getState().markTaskStartingDone(task.taskNumber);
    // A successful spawn swapped the slot for the real ptyId; anything else
    // leaves it behind as a card that would never resolve.
    if (useTerminalStore.getState().terminalsByProject[project.path]?.includes(slotId)) {
      useTerminalStore.getState().removeTerminal(slotId);
    }
  }
}

/**
 * What opening a task does, given the state it happens to be in.
 *
 * Two surfaces offer "take me to the work on this": the mod+K switcher's task
 * rows and the GitHub panel's issue rows.
 */
export type TaskOpenAction = 'focus' | 'open' | 'start';

export const TASK_OPEN_LABEL: Record<TaskOpenAction, string> = {
  focus: 'Focus terminal',
  open: 'Open worktree',
  start: 'Start task',
};

/** The live shell for a task, if one is registered for its project. */
function liveTerminalForTask(projectPath: string, taskNumber: number): string | null {
  const store = useTerminalStore.getState();
  for (const ptyId of store.terminalsByProject[projectPath] ?? []) {
    const display = store.displayStates[ptyId];
    if (display && !display.isLoading && display.taskId === taskNumber) return ptyId;
  }
  return null;
}

export function taskOpenAction(projectPath: string, task: TaskWithWorkspace): TaskOpenAction {
  if (liveTerminalForTask(projectPath, task.taskNumber)) return 'focus';
  return task.worktreePath && task.branch ? 'open' : 'start';
}

/**
 * Go to a task's work: focus its shell, open one in its worktree, or create the
 * worktree first.
 *
 * `knownPtyId` lets a caller that already resolved a live shell pass it in. The
 * switcher does: it merges the store with `getActiveSessions`, so it can see
 * shells in projects this renderer never hydrated, which a store lookup here
 * would miss.
 */
export async function activateTask(project: Project, task: TaskWithWorkspace, knownPtyId?: string): Promise<void> {
  const ptyId = knownPtyId ?? liveTerminalForTask(project.path, task.taskNumber);
  if (ptyId) {
    await focusTerminal(ptyId, { projectPath: project.path });
    return;
  }
  if (task.worktreePath && task.branch) {
    await openTasks([{ project, task }], 'shell');
    return;
  }
  await startTaskWorktree(project, task);
}
