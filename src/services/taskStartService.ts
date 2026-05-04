/**
 * Task-start lifecycle. Owns the choreography of:
 *   - kicking off worktree creation
 *   - showing the proactive hook prompt
 *   - waiting for both to be ready, then spawning a terminal that runs the hook
 *
 * Lives outside any component so toggling between kanban and terminal views
 * does not abort or break in-flight starts. State is held in `projectStore`.
 */

import log from 'electron-log/renderer';
import { addProjectTerminal, closeProjectTerminal } from '../components/terminal/terminalActions';
import type { RunHookResult } from '../components/dialogs/RunHookDialog';
import { loadingSlotId } from '../components/terminal/loadingSlot';
import { useProjectStore } from '../stores/projectStore';
import { useTerminalStore } from '../stores/terminalStore';
import type { HookType, ScriptHook, TaskStatus, TaskWithWorkspace } from '../types';

const taskStartLog = log.scope('taskStart');

const surfacedWarnings = new Set<string>();

export function surfaceStartWarnings(warnings?: string[]): void {
  if (!warnings) return;
  for (const w of warnings) {
    if (surfacedWarnings.has(w)) continue;
    surfacedWarnings.add(w);
    useProjectStore.getState().addToast(w, 'info');
  }
}

function hookTypeForTransition(origStatus: TaskStatus, newStatus: TaskStatus): HookType | null {
  if (origStatus === newStatus) return null;
  if (newStatus === 'in_progress') return origStatus === 'todo' ? 'start' : 'continue';
  if (newStatus === 'in_review') return 'review';
  if (newStatus === 'done') return 'cleanup';
  return null;
}

export interface BeginTransitionOptions {
  /** Original status before the drag — used to disambiguate start vs continue. */
  origStatus: TaskStatus;
  /** New column the task landed in. */
  newStatus: TaskStatus;
  /** Snapshot of the task at drop time. */
  task: TaskWithWorkspace;
  /** Hide the kanban (for foreground hook runs) when invoked. */
  onForegroundOpen?: () => void;
}

/**
 * Begin a task-status transition. Returns immediately — the operation runs to
 * completion in the background, surviving any view changes.
 */
export function beginTransition(projectPath: string, opts: BeginTransitionOptions): void {
  const { origStatus, newStatus, task, onForegroundOpen } = opts;
  const taskNumber = task.taskNumber;
  const t0 = performance.now();
  taskStartLog.info('beginTransition', { taskNumber, origStatus, newStatus });

  void runTransition(projectPath, task, origStatus, newStatus, onForegroundOpen, t0).catch((err) => {
    taskStartLog.error('transition failed', {
      taskNumber,
      error: err instanceof Error ? err.message : String(err),
    });
    useProjectStore.getState().addToast('Task transition failed', 'error');
    useProjectStore.getState().markTaskStartingDone(taskNumber);
  });
}

async function runTransition(
  projectPath: string,
  task: TaskWithWorkspace,
  origStatus: TaskStatus,
  newStatus: TaskStatus,
  onForegroundOpen: (() => void) | undefined,
  t0: number,
): Promise<void> {
  const taskNumber = task.taskNumber;
  const transitioningToInProgress = newStatus === 'in_progress';
  const slotId = transitioningToInProgress ? loadingSlotId(taskNumber) : null;

  // Insert a synthetic loading slot into the terminal stack right away so the
  // user immediately sees a placeholder card (with full chrome, hover, click
  // cycling) while we work. The real terminal will replace it in place via
  // `rekeyTerminal` when it spawns.
  if (slotId) {
    useProjectStore.getState().markTaskStarting(taskNumber);
    useTerminalStore.getState().addTerminal(projectPath, slotId, { label: task.name, taskId: taskNumber });
    useTerminalStore.getState().activateLast(projectPath);
  }

  try {
    // 1. Look up any configured hook for this transition.
    const hookType = hookTypeForTransition(origStatus, newStatus);
    let hook: ScriptHook | undefined;
    if (hookType) {
      const hooks = await window.api.hooks.get(projectPath);
      hook = hooks[hookType] ?? undefined;
    }

    // 2. Kick off worktree creation in parallel with the hook prompt.
    const needsWorktree = transitioningToInProgress && !task.worktreePath;
    let worktreePromise: Promise<{
      success: boolean;
      worktreePath?: string;
      branch?: string;
      error?: string;
      warnings?: string[];
    }> | null = null;
    if (needsWorktree) {
      const tStart = performance.now();
      worktreePromise = window.api.task.start(projectPath, taskNumber).then((res) => {
        taskStartLog.info('worktree ready', {
          taskNumber,
          ms: Math.round(performance.now() - tStart),
          success: res.success,
        });
        return {
          success: res.success,
          worktreePath: res.worktreePath,
          branch: res.task?.branch,
          error: res.error,
          warnings: res.warnings,
        };
      });
    }

    // 3. Show the hook dialog proactively if one is configured.
    let hookPromise: Promise<RunHookResult | null> = Promise.resolve(null);
    if (hookType && hook) {
      const tDialog = performance.now();
      hookPromise = useProjectStore
        .getState()
        .requestRunHook({ projectPath, hookType, hook, task })
        .then((res) => {
          taskStartLog.info('hook dialog closed', {
            taskNumber,
            ms: Math.round(performance.now() - tDialog),
            accepted: !!res,
          });
          return res;
        });
    }

    // 4. Wait for both. Hook command runs only once the worktree is ready.
    const [worktreeResult, hookResult] = await Promise.all([worktreePromise, hookPromise]);

    // 5. Apply worktree outcome.
    let resolvedTask = task;
    if (worktreeResult) {
      if (!worktreeResult.success) {
        useProjectStore.getState().addToast(worktreeResult.error || 'Failed to create worktree', 'error');
        await useProjectStore.getState().loadTasks(projectPath);
        return;
      }
      surfaceStartWarnings(worktreeResult.warnings);
      if (worktreeResult.worktreePath) {
        resolvedTask = {
          ...task,
          worktreePath: worktreeResult.worktreePath,
          branch: worktreeResult.branch || task.branch,
        };
      }
    }

    await useProjectStore.getState().loadTasks(projectPath);

    // 6. Spawn the terminal. For in_progress drops we always open a terminal
    // (with the hook command if accepted, otherwise a plain shell) so the
    // loading slot always morphs into a real card. For review/done the
    // terminal only spawns if the user accepted the hook.
    if (transitioningToInProgress) {
      await spawnTerminalForInProgress(projectPath, resolvedTask, hookResult, slotId, onForegroundOpen);
    } else if (hookResult) {
      await runNonStartHookInTerminal(projectPath, resolvedTask, newStatus, hookResult, onForegroundOpen);
    }

    taskStartLog.info('transition complete', {
      taskNumber,
      totalMs: Math.round(performance.now() - t0),
      ranHook: !!hookResult,
    });
  } finally {
    if (transitioningToInProgress) {
      useProjectStore.getState().markTaskStartingDone(taskNumber);
      // Clean up the loading slot if it's still around (failure or no spawn).
      // Successful spawns swap it for the real ptyId via rekeyTerminal.
      if (slotId) {
        const stillThere = useTerminalStore.getState().terminalsByProject[projectPath]?.includes(slotId);
        if (stillThere) {
          useTerminalStore.getState().removeTerminal(slotId);
        }
      }
    }
  }
}

/**
 * Spawn a terminal for a task that just landed in in_progress. Always opens a
 * terminal so the loading slot always resolves into a real card. The hook
 * command runs if the user accepted it; otherwise it's a plain shell.
 */
async function spawnTerminalForInProgress(
  projectPath: string,
  task: TaskWithWorkspace,
  hookResult: RunHookResult | null,
  loadingSlot: string | null,
  onForegroundOpen?: () => void,
): Promise<void> {
  if (!task.worktreePath) {
    // Worktree creation must have failed earlier; nothing to do.
    return;
  }

  const runConfig = hookResult
    ? { name: 'Start', command: hookResult.command, source: 'custom' as const, priority: 0 }
    : undefined;

  await addProjectTerminal(projectPath, runConfig, {
    existingWorktree: { path: task.worktreePath, branch: task.branch || '', createdAt: task.createdAt },
    taskId: task.taskNumber,
    sandboxed: hookResult?.sandboxed,
    skipAutoHook: true,
    replaceLoadingId: loadingSlot ?? undefined,
  });

  if (hookResult?.foreground && onForegroundOpen) onForegroundOpen();
}

async function runNonStartHookInTerminal(
  projectPath: string,
  task: TaskWithWorkspace,
  newStatus: TaskStatus,
  hookResult: RunHookResult,
  onForegroundOpen?: () => void,
): Promise<void> {
  if (newStatus === 'in_review' && task.worktreePath) {
    await addProjectTerminal(
      projectPath,
      { name: 'Review', command: hookResult.command, source: 'custom', priority: 0 },
      {
        existingWorktree: { path: task.worktreePath, branch: task.branch || '', createdAt: task.createdAt },
        taskId: task.taskNumber,
        skipAutoHook: true,
        sandboxed: hookResult.sandboxed,
        background: !hookResult.foreground,
      },
    );
    if (hookResult.foreground && onForegroundOpen) onForegroundOpen();
    return;
  }

  if (newStatus === 'done') {
    if (task.worktreePath) {
      await addProjectTerminal(
        projectPath,
        { name: 'Cleanup', command: hookResult.command, source: 'custom', priority: 0 },
        {
          existingWorktree: { path: task.worktreePath, branch: task.branch || '', createdAt: task.createdAt },
          taskId: task.taskNumber,
          skipAutoHook: true,
          sandboxed: hookResult.sandboxed,
          background: !hookResult.foreground,
        },
      );
      if (hookResult.foreground && onForegroundOpen) onForegroundOpen();
    }
    // Close all terminals tied to this task once it's done.
    const store = useTerminalStore.getState();
    const ptyIds = store.terminalsByProject[projectPath] ?? [];
    for (const ptyId of [...ptyIds]) {
      const display = store.displayStates[ptyId];
      if (display?.taskId === task.taskNumber) {
        closeProjectTerminal(ptyId);
      }
    }
  }
}
