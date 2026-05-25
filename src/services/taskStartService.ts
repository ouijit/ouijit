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
import { addProjectTerminal } from '../components/terminal/terminalActions';
import type { RunHookResult } from '../components/dialogs/RunHookDialog';
import { completeTask } from './taskCompletion';
import { useProjectStore } from '../stores/projectStore';
import { useTerminalStore } from '../stores/terminalStore';
import type { CliHookMode, HookType, ScriptHook, TaskStatus, TaskWithWorkspace } from '../types';

let placeholderCounter = 0;
function makePlaceholderId(taskNumber: number): string {
  return `pending-${taskNumber}-${++placeholderCounter}`;
}

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
  // 'done' is handled by completeTask, not beginTransition.
  return null;
}

/**
 * CLI-driven hook control. When present, the start-hook dialog is skipped
 * entirely — the caller has already decided what should happen. Used by
 * `ouijit task start --run-hook/--skip-hook/--hook-command` so an agent can
 * start a task headlessly without a human at the dialog.
 */
export interface HookControl {
  mode: CliHookMode;
  /** The one-off command, required when `mode` is `command`. */
  command?: string;
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
  /** CLI-driven hook control — when set, the start-hook dialog is skipped. */
  hookControl?: HookControl;
}

/**
 * Begin a task-status transition. Returns immediately — the operation runs to
 * completion in the background, surviving any view changes.
 */
export function beginTransition(projectPath: string, opts: BeginTransitionOptions): void {
  const { origStatus, newStatus, task, onForegroundOpen, hookControl } = opts;
  const taskNumber = task.taskNumber;
  const t0 = performance.now();
  taskStartLog.info('beginTransition', { taskNumber, origStatus, newStatus, hookMode: hookControl?.mode });

  void runTransition(projectPath, task, origStatus, newStatus, onForegroundOpen, hookControl, t0).catch((err) => {
    taskStartLog.error('transition failed', {
      taskNumber,
      error: err instanceof Error ? err.message : String(err),
    });
    useProjectStore.getState().addToast('Task transition failed', 'error');
    useProjectStore.getState().markTaskStartingDone(taskNumber);
  });
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
};

/**
 * Bulk-move several tasks to the same target status, then fan each one out
 * through `beginTransition` so worktrees get created and hook dialogs fire.
 * Used by the kanban's bulk action bar and multi-select drag — both produce
 * an N-task move that previously stopped at `setStatus` and silently skipped
 * every downstream hook. The hook dialogs queue up via `runHookQueue`,
 * presenting as a stepper instead of dropping all but the last.
 *
 * Returns the list of transitions that actually fired (filtered to tasks
 * whose status differed from the target). Selection is cleared and a toast
 * is emitted as a side effect.
 */
export async function bulkTransitionTasks(
  projectPath: string,
  taskNumbers: number[],
  newStatus: TaskStatus,
): Promise<Array<{ task: TaskWithWorkspace; origStatus: TaskStatus }>> {
  const store = useProjectStore.getState();
  const tasksByNumber = new Map(store.tasks.map((t) => [t.taskNumber, t]));
  // Snapshot each task's status BEFORE mutating so we can drive beginTransition
  // with the right origStatus per task (start vs continue, etc.).
  const transitions = taskNumbers
    .map((n) => tasksByNumber.get(n))
    .filter((t): t is TaskWithWorkspace => !!t && t.status !== newStatus)
    .map((task) => ({ task, origStatus: task.status }));

  // Done has its own lifecycle (completeTask) that writes status itself, so
  // bulk-to-done fans straight into completeTask. Other statuses pre-write via
  // setStatus, then beginTransition handles the (start/continue/review) hook.
  if (newStatus === 'done') {
    const results = await Promise.allSettled(transitions.map(({ task }) => completeTask({ projectPath, task })));
    const succeeded: typeof transitions = [];
    const failed: Array<{ taskNumber: number; error: string }> = [];
    results.forEach((r, i) => {
      const tr = transitions[i];
      if (r.status === 'rejected') {
        failed.push({
          taskNumber: tr.task.taskNumber,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
      } else {
        succeeded.push(tr);
      }
    });
    store.clearSelection();
    if (succeeded.length > 0) {
      useProjectStore.getState().addToast(`Moved ${succeeded.length} tasks to ${STATUS_LABEL[newStatus]}`, 'success');
    }
    if (failed.length > 0) {
      const sample = failed[0].error;
      const suffix = failed.length > 1 ? ` (and ${failed.length - 1} more)` : '';
      useProjectStore.getState().addToast(`Failed to move ${failed.length} tasks: ${sample}${suffix}`, 'error');
    }
    return succeeded;
  }

  const results = await Promise.allSettled(
    transitions.map(({ task }) => window.api.task.setStatus(projectPath, task.taskNumber, newStatus)),
  );
  // Drop any task whose status change didn't actually land — both IPC
  // rejections and { success: false } responses. Otherwise beginTransition
  // would create a worktree for a task whose server-side status is still
  // the old one.
  const succeeded: typeof transitions = [];
  const failed: Array<{ taskNumber: number; error: string }> = [];
  results.forEach((r, i) => {
    const tr = transitions[i];
    if (r.status === 'rejected') {
      failed.push({
        taskNumber: tr.task.taskNumber,
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      });
    } else if (!r.value.success) {
      failed.push({ taskNumber: tr.task.taskNumber, error: r.value.error ?? 'Failed to update status' });
    } else {
      succeeded.push(tr);
    }
  });

  await store.loadTasks(projectPath);
  store.clearSelection();

  for (const { task, origStatus } of succeeded) {
    beginTransition(projectPath, { origStatus, newStatus, task });
  }

  if (succeeded.length > 0) {
    useProjectStore.getState().addToast(`Moved ${succeeded.length} tasks to ${STATUS_LABEL[newStatus]}`, 'success');
  }
  if (failed.length > 0) {
    const sample = failed[0].error;
    const suffix = failed.length > 1 ? ` (and ${failed.length - 1} more)` : '';
    useProjectStore.getState().addToast(`Failed to move ${failed.length} tasks: ${sample}${suffix}`, 'error');
  }
  return succeeded;
}

async function runTransition(
  projectPath: string,
  task: TaskWithWorkspace,
  origStatus: TaskStatus,
  newStatus: TaskStatus,
  onForegroundOpen: (() => void) | undefined,
  hookControl: HookControl | undefined,
  t0: number,
): Promise<void> {
  const taskNumber = task.taskNumber;
  const transitioningToInProgress = newStatus === 'in_progress';

  // De-dupe: if the same task is already mid-start, drop this drop.
  if (transitioningToInProgress && useProjectStore.getState().startingTaskNumbers.has(taskNumber)) {
    taskStartLog.info('skipping duplicate start', { taskNumber });
    return;
  }

  const slotId = transitioningToInProgress ? makePlaceholderId(taskNumber) : null;

  // Insert a placeholder slot into the terminal stack right away so the user
  // immediately sees a card (with full chrome, hover, click cycling) flagged
  // as `isLoading`. The real terminal will replace it in place via
  // `rekeyTerminal` when it spawns, and the flag clears.
  if (slotId) {
    useProjectStore.getState().markTaskStarting(taskNumber);
    useTerminalStore
      .getState()
      .addTerminal(projectPath, slotId, { label: task.name, taskId: taskNumber, isLoading: true });
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

    // 3. Resolve the hook to run. A CLI caller (hookControl) has already
    // decided — skip the dialog entirely. Otherwise show the dialog
    // proactively if a hook is configured for this transition.
    let hookPromise: Promise<RunHookResult | null> = Promise.resolve(null);
    if (hookControl) {
      let resolved: RunHookResult | null = null;
      if (hookControl.mode === 'command' && hookControl.command) {
        resolved = { command: hookControl.command, sandboxed: false, foreground: false };
      } else if (hookControl.mode === 'run' && hook) {
        resolved = { command: hook.command, sandboxed: false, foreground: false };
      }
      // 'skip', or 'run' with no configured hook → plain shell (null).
      taskStartLog.info('hook resolved from CLI flags', {
        taskNumber,
        mode: hookControl.mode,
        ranHook: !!resolved,
      });
      hookPromise = Promise.resolve(resolved);
    } else if (hookType && hook) {
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
          // For an in_progress drop with "Run & Open", reveal the terminal
          // stack right away. The loading placeholder is already on-screen
          // and the worktree is still creating in parallel — there's no
          // reason to make the user wait staring at the kanban.
          if (res?.foreground && transitioningToInProgress && onForegroundOpen) {
            onForegroundOpen();
          }
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
      await spawnTerminalForInProgress(projectPath, resolvedTask, hookResult, slotId);
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
 *
 * Note: the kanban-hide for foreground hooks happens earlier (right after the
 * dialog returns) so the user sees the loading placeholder immediately.
 */
async function spawnTerminalForInProgress(
  projectPath: string,
  task: TaskWithWorkspace,
  hookResult: RunHookResult | null,
  loadingSlot: string | null,
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
  }
}
