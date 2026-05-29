/**
 * Single done-transition lifecycle. All three entry points (kanban drag,
 * terminal Close Task menu, CLI set-status done) funnel through `completeTask`
 * so the observable behavior of marking a task done is identical regardless
 * of where it's triggered.
 *
 * Order is (prompt) → snapshot → spawn → close → persist. With no hookControl
 * the Done dialog is shown first — the same prompt every other column shows —
 * and its result drives the spawn; shift-drag and the CLI pass an explicit
 * hookControl to run/skip headlessly. The snapshot is taken after the prompt
 * resolves but before the new done-hook terminal is spawned, so the new
 * terminal is excluded from closure by construction.
 */

import log from 'electron-log/renderer';
import { addProjectTerminal, closeProjectTerminal } from '../components/terminal/terminalActions';
import { useAppStore } from '../stores/appStore';
import { useProjectStore } from '../stores/projectStore';
import { useTerminalStore } from '../stores/terminalStore';
import type { CliHookMode, TaskWithWorkspace } from '../types';

const completionLog = log.scope('taskCompletion');

/**
 * Governs the done hook for a completion. Mirrors the start/continue/review
 * transitions so Done behaves uniformly across the four columns:
 *   - omitted             → show the Done dialog (if a done hook is configured)
 *   - { mode: 'skip' }        → run no hook
 *   - { mode: 'run' }         → run the configured done hook headless (no dialog)
 *   - { mode: 'command', ... }→ run a one-off command headless
 * The terminal-cleanup + status-write lifecycle runs regardless of this choice.
 */
export interface CompleteHookControl {
  mode: CliHookMode;
  /** The one-off command, required when `mode` is `command`. */
  command?: string;
}

export interface CompleteTaskOptions {
  projectPath: string;
  task: TaskWithWorkspace;
  /**
   * How to handle the done hook. Omit to prompt with the Done dialog (the
   * default for a kanban drop / terminal "Close Task"); set it to run the hook
   * headlessly, run a custom command, or skip — used by shift-drag and the CLI.
   */
  hookControl?: CompleteHookControl;
  /**
   * Kanban-only: when set, also reorder the task within the done column.
   * When omitted, only the status is written.
   */
  targetIndex?: number;
  /**
   * Skip the `setStatus` write — the server has already persisted the status
   * (e.g. the CLI path: server PATCHed, then pushed `cli:task-completed`).
   * The renderer still needs to reload tasks to reflect the new status.
   */
  skipStatusWrite?: boolean;
}

/**
 * Per-(project, task) in-flight gate. A second concurrent call awaits the
 * first instead of running its own lifecycle — without this, two callers
 * (e.g. a shift-drag racing the CLI's cli:task-completed push) can each
 * snapshot the other's freshly-spawned done-hook terminal and then close it.
 */
const inFlight = new Map<string, Promise<void>>();

export async function completeTask(opts: CompleteTaskOptions): Promise<void> {
  const key = `${opts.projectPath}:${opts.task.taskNumber}`;
  const existing = inFlight.get(key);
  if (existing) {
    completionLog.info('completeTask already in flight, awaiting prior call', {
      taskNumber: opts.task.taskNumber,
      projectPath: opts.projectPath,
    });
    return existing;
  }
  const promise = completeTaskInner(opts).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

async function completeTaskInner(opts: CompleteTaskOptions): Promise<void> {
  const { projectPath, task, hookControl, targetIndex, skipStatusWrite } = opts;
  const taskNumber = task.taskNumber;
  completionLog.info('completing task', {
    taskNumber,
    projectPath,
    hookMode: hookControl?.mode ?? 'prompt',
    hasTargetIndex: targetIndex != null,
    skipStatusWrite,
  });

  // 1. Resolve the effective hook command + how to run it. With no hookControl
  //    the Done dialog is shown (if a hook is configured), matching the dialog
  //    every other column transition shows; the dialog's foreground/sandbox
  //    choices are honored. Headless modes (run/command/skip) come from
  //    shift-drag or the CLI flags and never prompt.
  let effectiveCommand: string | null = null;
  let foreground = false;
  let sandboxed = false;
  if (hookControl?.mode === 'skip') {
    // Run no hook.
  } else if (hookControl?.mode === 'command' && hookControl.command) {
    effectiveCommand = hookControl.command;
  } else if (hookControl?.mode === 'run') {
    const hooks = await window.api.hooks.get(projectPath);
    if (hooks.done) effectiveCommand = hooks.done.command;
  } else if (!hookControl) {
    const hooks = await window.api.hooks.get(projectPath);
    if (hooks.done) {
      const result = await useProjectStore
        .getState()
        .requestRunHook({ projectPath, hookType: 'done', hook: hooks.done, task });
      if (result) {
        effectiveCommand = result.command;
        foreground = result.foreground;
        sandboxed = result.sandboxed;
      }
    }
  }

  // 2. Snapshot existing task terminals BEFORE spawning the hook terminal,
  //    so the new terminal is excluded from the close sweep.
  const termStore = useTerminalStore.getState();
  const snapshot = (termStore.terminalsByProject[projectPath] ?? []).filter((ptyId) => {
    const d = termStore.displayStates[ptyId];
    return d != null && d.taskId === taskNumber && !d.isLoading;
  });

  // 3. Spawn the done-hook terminal if there's a command and a worktree to run it in.
  //    The shell-integration precmd hook emits OSC 133;D;<exit_code> after the
  //    command runs; the renderer flips the status to success/error and (for
  //    autoCloseOnSuccess: true) schedules a tidy-up on success. The PTY itself
  //    drops into an interactive shell at the worktree, so failures leave a
  //    usable debugging surface instead of a dead terminal.
  if (effectiveCommand && task.worktreePath) {
    try {
      await addProjectTerminal(
        projectPath,
        { name: 'Done', command: effectiveCommand, source: 'custom', priority: 0 },
        {
          existingWorktree: { path: task.worktreePath, branch: task.branch || '', createdAt: task.createdAt },
          taskId: taskNumber,
          skipAutoHook: true,
          sandboxed,
          // "Run & Open" (foreground) brings the hook terminal up so the user
          // can watch it; the background run stays out of the way and tidies up
          // on success. Either way the hook terminal is excluded from the close
          // sweep by the snapshot taken above.
          background: !foreground,
          autoCloseOnSuccess: !foreground,
        },
      );
    } catch (err) {
      // Persist status anyway — the user moved the task to done and the
      // intent should survive a hook-spawn failure. Surface the failure
      // explicitly so they can re-run the hook manually if it matters.
      const message = err instanceof Error ? err.message : String(err);
      completionLog.error('done-hook spawn failed', { taskNumber, error: message });
      useProjectStore.getState().addToast(`Done hook failed to start: ${message}`, 'error');
    }
  }

  // 4. Close the snapshotted terminals.
  for (const ptyId of snapshot) {
    closeProjectTerminal(ptyId);
  }

  // 5. Persist status (and order, for the kanban-drag entry point).
  //    moveTask reloads the task list itself; the bare setStatus path has to
  //    do it explicitly so the kanban reflects the new status. The CLI path
  //    sets `skipStatusWrite` because the server already PATCHed before
  //    pushing — only the renderer reload is needed.
  if (targetIndex != null) {
    await useProjectStore.getState().moveTask(projectPath, taskNumber, 'done', targetIndex);
  } else {
    if (!skipStatusWrite) await window.api.task.setStatus(projectPath, taskNumber, 'done');
    // loadTasks writes into projectStore.tasks, a singleton holding the
    // *active* project's task list. Calling it for a non-active project
    // would clobber the visible kanban with the wrong project's tasks.
    // The non-active case is unreachable today (useIPCListeners gates on
    // active project) but guarded here so a future caller can't reintroduce
    // the bug. The proper fix — multi-project projectStore — is task #417.
    if (useAppStore.getState().activeProjectPath === projectPath) {
      await useProjectStore.getState().loadTasks(projectPath);
    }
  }
}
