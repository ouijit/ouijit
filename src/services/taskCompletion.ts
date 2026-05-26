/**
 * Single done-transition lifecycle. All three entry points (kanban drag,
 * terminal Close Task menu, CLI set-status done) funnel through `completeTask`
 * so the observable behavior of marking a task done is identical regardless
 * of where it's triggered.
 *
 * Order is snapshot → spawn → close → persist. The snapshot is taken before
 * the new done-hook terminal is spawned, so the new terminal is excluded from
 * closure by construction.
 */

import log from 'electron-log/renderer';
import { addProjectTerminal, closeProjectTerminal } from '../components/terminal/terminalActions';
import { useProjectStore } from '../stores/projectStore';
import { useTerminalStore } from '../stores/terminalStore';
import type { TaskWithWorkspace } from '../types';

const completionLog = log.scope('taskCompletion');

export interface CompleteTaskOptions {
  projectPath: string;
  task: TaskWithWorkspace;
  /** Skip the configured done hook for this transition. */
  skipHook?: boolean;
  /** Override the configured done hook's command for this transition. */
  hookCommand?: string;
  /**
   * Kanban-only: when set, also reorder the task within the done column.
   * When omitted, only the status is written.
   */
  targetIndex?: number;
}

export async function completeTask(opts: CompleteTaskOptions): Promise<void> {
  const { projectPath, task, skipHook, hookCommand, targetIndex } = opts;
  const taskNumber = task.taskNumber;
  completionLog.info('completing task', {
    taskNumber,
    projectPath,
    skipHook,
    hasHookCommand: !!hookCommand,
    hasTargetIndex: targetIndex != null,
  });

  // 1. Resolve the effective hook command.
  let effectiveCommand: string | null = null;
  if (hookCommand) {
    effectiveCommand = hookCommand;
  } else if (!skipHook) {
    const hooks = await window.api.hooks.get(projectPath);
    if (hooks.done) effectiveCommand = hooks.done.command;
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
    await addProjectTerminal(
      projectPath,
      { name: 'Done', command: effectiveCommand, source: 'custom', priority: 0 },
      {
        existingWorktree: { path: task.worktreePath, branch: task.branch || '', createdAt: task.createdAt },
        taskId: taskNumber,
        skipAutoHook: true,
        background: true,
        autoCloseOnSuccess: true,
      },
    );
  }

  // 4. Close the snapshotted terminals.
  for (const ptyId of snapshot) {
    closeProjectTerminal(ptyId);
  }

  // 5. Persist status (and order, for the kanban-drag entry point).
  //    moveTask reloads the task list itself; the bare setStatus path has to
  //    do it explicitly so the kanban reflects the new status.
  if (targetIndex != null) {
    await useProjectStore.getState().moveTask(projectPath, taskNumber, 'done', targetIndex);
  } else {
    await window.api.task.setStatus(projectPath, taskNumber, 'done');
    await useProjectStore.getState().loadTasks(projectPath);
  }
}
