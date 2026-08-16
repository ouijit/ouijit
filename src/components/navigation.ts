/**
 * Shared navigation actions.
 *
 * The sidebar, the app-init restore and the command palette all need the same
 * "go to this project / home / terminal" behavior, and the sequences are
 * order-sensitive (tasks are pre-fetched before navigating so the kanban paints
 * correctly through the view-transition snapshot; the terminal card stack
 * reverts an active index that a tag filter hides).
 */

import type { Project, TaskWithWorkspace } from '../types';
import { useAppStore } from '../stores/appStore';
import { useProjectStore } from '../stores/projectStore';
import { useTerminalStore, terminalMatchesTag } from '../stores/terminalStore';
import { useCanvasStore } from '../stores/canvasStore';
import { useUIStore } from '../stores/uiStore';
import { addProjectTerminal, reconnectOrphanedSessions } from './terminal/terminalActions';
import { makePlaceholderId, surfaceStartWarnings } from '../services/taskStartService';
import { terminalInstances } from './terminal/terminalReact';

/**
 * Navigate to a project. Direction of the view transition reflects the
 * relative position in the sidebar — a project below the current one slides the
 * new view up into place, above slides down. Home is the top of the list.
 *
 * Tasks are loaded before navigating so the first paint of the project view
 * (kanban included) shows real content rather than an empty board.
 */
export async function selectProject(path: string, project: Project): Promise<void> {
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
 * Bring a terminal to the front, wherever it lives.
 *
 * A session that this renderer hasn't hydrated yet (its project was never
 * visited this launch) is reconnected first — `reconnectOrphanedSessions` is
 * idempotent, so this is safe for already-registered projects too.
 *
 * `projectPath` is only needed for that not-yet-hydrated case; for a terminal
 * already in the store it's read from the display state.
 */
export async function focusTerminal(ptyId: string, projectPath?: string): Promise<void> {
  let display = useTerminalStore.getState().displayStates[ptyId];
  if (!display) {
    if (!projectPath) return;
    await reconnectOrphanedSessions(projectPath);
    display = useTerminalStore.getState().displayStates[ptyId];
    if (!display) return;
  }

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

  await selectProject(ownerPath, project);

  const store = useProjectStore.getState();
  store.setActivePanel('terminals');
  store.setKanbanVisible(false);

  if (store.terminalLayout === 'canvas') {
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

export interface TaskWorktreeTarget {
  project: Project;
  taskNumber: number;
  worktreePath: string;
  branch: string;
  createdAt: string;
}

/**
 * Open a plain shell in an existing task worktree.
 *
 * `skipAutoHook` keeps this a pure navigation action: without it,
 * `addProjectTerminal` substitutes the project's continue hook as the start
 * command and relaunches the agent (what the home recents panel wants, not what
 * a switcher should do).
 *
 * Spawns before navigating, matching the recents panel — the project view force-
 * shows the kanban when it mounts with no terminals registered for the project.
 */
export async function openTaskWorktree(target: TaskWorktreeTarget): Promise<void> {
  const added = await addProjectTerminal(target.project.path, undefined, {
    existingWorktree: {
      path: target.worktreePath,
      branch: target.branch,
      createdAt: target.createdAt,
    },
    taskId: target.taskNumber,
    skipAutoHook: true,
  });
  if (!added) return;

  await selectProject(target.project.path, target.project);
  const store = useProjectStore.getState();
  store.setActivePanel('terminals');
  store.setKanbanVisible(false);
}

/**
 * Create a task's worktree, then open a shell in it.
 *
 * The path for a task that has never been started. `beginTask` behind
 * `task.start` creates the branch and worktree and moves a todo task to
 * in_progress; it runs no hook, and the spawn skips the continue hook, so what
 * lands is a plain shell in a new worktree. Same sequence the board's "open in
 * terminal" and the home recents panel already use for a task with no
 * worktree.
 *
 * Creating a worktree takes long enough to see, so this borrows the kanban
 * drop's staging rather than awaiting it behind a closed palette: a loading slot
 * goes into the stack first and the view moves to it immediately, so the card is
 * on screen — with its chrome, in its final position — while git works. The real
 * terminal then takes that slot's place via `replaceLoadingId` instead of
 * appearing from nowhere once everything is ready.
 */
export async function startTaskWorktree(
  project: Project,
  taskNumber: number,
  createdAt: string,
  taskName: string,
): Promise<void> {
  // A second Enter on a row whose start is still in flight would stage a
  // duplicate slot and race the first spawn.
  if (useProjectStore.getState().startingTaskNumbers.has(taskNumber)) return;

  const slotId = makePlaceholderId(taskNumber);
  useProjectStore.getState().markTaskStarting(taskNumber);
  useTerminalStore
    .getState()
    .addTerminal(project.path, slotId, { label: taskName, taskId: taskNumber, isLoading: true });

  try {
    // Navigate with the slot already registered: the project view force-shows
    // the kanban when it mounts with no terminals for the project.
    await selectProject(project.path, project);
    const store = useProjectStore.getState();
    store.setActivePanel('terminals');
    store.setKanbanVisible(false);
    useTerminalStore.getState().activateLast(project.path);

    const result = await window.api.task.start(project.path, taskNumber);
    if (!result.success || !result.worktreePath) {
      useProjectStore.getState().addToast(result.error || `Failed to open T-${taskNumber}`, 'error');
      return;
    }
    surfaceStartWarnings(result.warnings);
    void useProjectStore.getState().loadTasks(project.path);

    await addProjectTerminal(project.path, undefined, {
      existingWorktree: {
        path: result.worktreePath,
        branch: result.task?.branch || '',
        createdAt,
      },
      taskId: taskNumber,
      skipAutoHook: true,
      replaceLoadingId: slotId,
    });
  } finally {
    useProjectStore.getState().markTaskStartingDone(taskNumber);
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
    await openTaskWorktree({
      project,
      taskNumber: task.taskNumber,
      worktreePath: task.worktreePath,
      branch: task.branch,
      createdAt: task.createdAt,
    });
    return;
  }
  await startTaskWorktree(project, task.taskNumber, task.createdAt, task.name || 'Untitled');
}
