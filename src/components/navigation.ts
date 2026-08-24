/**
 * Shared navigation actions for the sidebar, the command palette, the board
 * and the home recents panel. The sequences are order-sensitive: tasks are
 * pre-fetched before navigating so the kanban paints through the
 * view-transition snapshot, and the terminal card stack reverts an active
 * index a tag filter hides.
 *
 * Frecency records the target the user chose, once per gesture: a project jump
 * records the project, while landing in a project on the way to its task or
 * shell records only the task or shell. Internal navigation goes through
 * `showProject`, which stays silent.
 */

import type { Project, SandboxProviderId, TaskWithWorkspace } from '../types';
import { useAppStore } from '../stores/appStore';
import { useProjectStore } from '../stores/projectStore';
import { useTerminalStore, terminalMatchesTag } from '../stores/terminalStore';
import { useCanvasStore } from '../stores/canvasStore';
import { useUIStore } from '../stores/uiStore';
import { addProjectTerminal, reconnectOrphanedSessions } from './terminal/terminalActions';
import { makePlaceholderId, surfaceStartWarnings } from '../services/taskStartService';
import { terminalInstances } from './terminal/terminalReact';
import { projectKey, recordJump, taskKey, terminalFrecencyKey } from '../utils/paletteFrecency';

/**
 * Navigates to a project, transitioning in the direction of its position in the
 * sidebar. Tasks load first, so the project view's first paint has content.
 */
export async function selectProject(path: string, project: Project): Promise<void> {
  recordJump(projectKey(path));
  await showProject(path, project);
}

async function showProject(path: string, project: Project): Promise<void> {
  const state = useAppStore.getState();
  if (state.activeProjectPath === path) return;
  const orderedPaths = state.projects.map((p) => p.path);
  const oldIndex = state.activeView === 'home' ? -1 : orderedPaths.indexOf(state.activeProjectPath ?? '');
  const newIndex = orderedPaths.indexOf(path);
  const direction = newIndex > oldIndex ? 'down' : newIndex < oldIndex ? 'up' : undefined;
  await useProjectStore.getState().loadTasks(path);
  state.navigateToProject(path, project, { direction });
  window.api.globalSettings.set('lastActiveView', JSON.stringify({ type: 'project', path }));
}

/**
 * Navigate to a project and land on its terminals. Callers spawn or stage a
 * terminal first: the project view force-shows the kanban when it mounts with
 * none registered.
 */
async function showProjectTerminals(path: string, project: Project): Promise<void> {
  await showProject(path, project);
  const store = useProjectStore.getState();
  store.setActivePanel('terminals');
  store.setKanbanVisible(false);
}

/**
 * Navigate home. Navigates immediately — the cached `homeRecents` paints during
 * the view transition — and reconciles with a background refresh.
 */
export function selectHome(): void {
  const state = useAppStore.getState();
  if (state.activeView === 'home') return;
  state.navigateHome({ direction: 'up' });
  void state.loadHomeRecents();
  window.api.globalSettings.set('lastActiveView', JSON.stringify({ type: 'home' }));
}

/**
 * Records a jump to a shell under its palette row's identity: a task's shell
 * shares the task's key, so jumping to either feeds the same entry. Card-stack
 * and board switches call this too — they are jumps the switcher never sees.
 */
export function recordTerminalJump(ptyId: string): void {
  const display = useTerminalStore.getState().displayStates[ptyId];
  if (!display) return;
  recordJump(terminalFrecencyKey(ptyId, display, useAppStore.getState().taskCacheByProject));
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
export async function focusTerminal(ptyId: string, projectPath?: string): Promise<void> {
  let display = useTerminalStore.getState().displayStates[ptyId];
  if (!display) {
    if (!projectPath) return;
    await reconnectOrphanedSessions(projectPath);
    display = useTerminalStore.getState().displayStates[ptyId];
    if (!display) return;
  }

  recordTerminalJump(ptyId);

  const ownerPath = display.projectPath;
  const project = useAppStore.getState().projects.find((p) => p.path === ownerPath);

  // No registered project owns it: a shell spawned from home, or a project
  // that has since been removed. The home stack renders those.
  if (!project) {
    const ui = useUIStore.getState();
    if (ui.homeTagFilter && !terminalMatchesTag(display, ui.homeTagFilter)) {
      ui.setHomeTagFilter(null);
    }
    ui.setHomeActivePtyId(ptyId);
    selectHome();
    focusXterm(ptyId);
    return;
  }

  // A tag filter that hides the target would make this a no-op: the card stack
  // resets the active index back to the head of the visible list.
  const projectStore = useProjectStore.getState();
  if (projectStore.tagFilter && !terminalMatchesTag(display, projectStore.tagFilter)) {
    projectStore.setTagFilter(null);
  }

  await showProjectTerminals(ownerPath, project);

  if (useProjectStore.getState().terminalLayout === 'canvas') {
    const canvas = useCanvasStore.getState().canvasByProject[ownerPath];
    if (canvas) {
      const nodes = canvas.nodes.map((node) => ({ ...node, selected: node.id === ptyId }));
      useCanvasStore.getState().loadCanvas(ownerPath, { ...canvas, nodes });
    }
  } else {
    const terminals = useTerminalStore.getState().terminalsByProject[ownerPath] ?? [];
    const index = terminals.indexOf(ptyId);
    if (index >= 0) useTerminalStore.getState().setActiveIndex(ownerPath, index);
  }

  focusXterm(ptyId);
}

export interface OpenTaskShellOptions {
  /**
   * Open a plain shell even when the worktree already exists. Without it,
   * `addProjectTerminal` substitutes the project's continue hook and relaunches
   * the agent — what the board and the home recents panel want, and the
   * switcher does not.
   */
  skipAutoHook?: boolean;
  /** Sandbox backend for this terminal — passed straight to the spawn, never persisted on the task. */
  sandboxProvider?: SandboxProviderId;
  /** Loading slot the spawned terminal takes the place of. */
  replaceLoadingId?: string;
}

/**
 * Spawn a shell in a task's worktree, creating the worktree first for a task
 * that has never been started. `beginTask` behind `task.start` creates the
 * branch and worktree and moves a todo task to in_progress; it runs no hook,
 * and the fresh-worktree spawn always skips the continue hook, so what lands
 * there is a plain shell.
 *
 * Every surface that opens a task's terminal — the switcher, the board, the
 * home recents panel — comes through here, so the frecency record and the
 * start-failure toast live here. Navigating to the result is the caller's
 * concern. Returns false when nothing spawned.
 */
export async function openTaskShell(
  projectPath: string,
  task: TaskWithWorkspace,
  options?: OpenTaskShellOptions,
): Promise<boolean> {
  recordJump(taskKey(projectPath, task.taskNumber));

  let worktree =
    task.worktreePath && task.branch
      ? { path: task.worktreePath, branch: task.branch, createdAt: task.createdAt }
      : null;
  let skipAutoHook = options?.skipAutoHook;

  if (!worktree) {
    const result = await window.api.task.start(projectPath, task.taskNumber);
    if (!result.success || !result.worktreePath) {
      useProjectStore.getState().addToast(result.error || `Failed to open T-${task.taskNumber}`, 'error');
      return false;
    }
    surfaceStartWarnings(result.warnings);
    void useProjectStore.getState().loadTasks(projectPath);
    worktree = { path: result.worktreePath, branch: result.task?.branch || '', createdAt: task.createdAt };
    skipAutoHook = true;
  }

  return addProjectTerminal(projectPath, undefined, {
    existingWorktree: worktree,
    taskId: task.taskNumber,
    skipAutoHook,
    sandboxProvider: options?.sandboxProvider,
    replaceLoadingId: options?.replaceLoadingId,
  });
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
    await showProjectTerminals(project.path, project);
    useTerminalStore.getState().activateLast(project.path);

    await openTaskShell(project.path, task, { replaceLoadingId: slotId });
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
    await focusTerminal(ptyId, project.path);
    return;
  }
  if (task.worktreePath && task.branch) {
    const added = await openTaskShell(project.path, task, { skipAutoHook: true });
    if (added) await showProjectTerminals(project.path, project);
    return;
  }
  await startTaskWorktree(project, task);
}
