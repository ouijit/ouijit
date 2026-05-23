/**
 * CLI task commands — full task lifecycle via REST API.
 */

import type { Command } from 'commander';
import { get, post, patch, del, projectQuery } from '../api';
import { printJson, printError } from '../output';

const VALID_STATUSES = ['todo', 'in_progress', 'in_review', 'done'];

interface HookFlags {
  runHook?: boolean;
  skipHook?: boolean;
  hookCommand?: string;
}

/**
 * Resolve the --run-hook / --skip-hook / --hook-command flags into the
 * `hookMode` / `hookCommand` fields the task-start API understands.
 *
 * The flags are mutually exclusive. When none is passed the result is empty,
 * leaving the renderer to fall back to its default behavior (the start-hook
 * dialog) — exactly what a kanban todo → in_progress drop does.
 */
function resolveHookFlags(opts: HookFlags): { hookMode?: string; hookCommand?: string } | { error: string } {
  const used = [
    opts.runHook ? '--run-hook' : null,
    opts.skipHook ? '--skip-hook' : null,
    opts.hookCommand !== undefined ? '--hook-command' : null,
  ].filter((f): f is string => f !== null);
  if (used.length > 1) {
    return { error: `Only one of ${used.join(', ')} may be used` };
  }
  if (opts.runHook) return { hookMode: 'run' };
  if (opts.skipHook) return { hookMode: 'skip' };
  if (opts.hookCommand !== undefined) {
    if (!opts.hookCommand.trim()) return { error: '--hook-command requires a non-empty command' };
    return { hookMode: 'command', hookCommand: opts.hookCommand };
  }
  return {};
}

const STATUS_LABELS: Record<string, string> = {
  todo: 'Todo',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
};

export function registerTaskCommands(parent: Command, requireProject: () => string) {
  const task = parent
    .command('task')
    .description('Manage tasks')
    .addHelpText(
      'after',
      `
Examples:
  ouijit task create "Fix login bug"
  ouijit task create "Refactor auth" --prompt "Extract auth middleware"
  ouijit task list
  ouijit task current
  ouijit task start 5
  ouijit task start 5 --run-hook
  ouijit task start 5 --skip-hook
  ouijit task start 5 --hook-command "claude"
  ouijit task set-status 5 in_review
  ouijit task set-name 5 "Better name"
  ouijit task delete 5`,
    );

  task
    .command('list')
    .description('List all tasks (JSON array)')
    .action(async () => {
      const project = requireProject();
      const tasks = await get(`/api/tasks${projectQuery(project)}`);
      printJson(tasks);
    });

  task
    .command('get')
    .description('Get task by number')
    .argument('<number>', 'task number')
    .action(async (number: string) => {
      const num = parseInt(number, 10);
      if (isNaN(num)) return printError('Task number must be an integer');
      const project = requireProject();
      const t = await get(`/api/tasks/${num}${projectQuery(project)}`);
      if (!t) return printError(`Task ${num} not found`);
      printJson(t);
    });

  task
    .command('current')
    .description('Get the task owning this terminal (uses OUIJIT_PTY_ID)')
    .action(async () => {
      if (!process.env['OUIJIT_PTY_ID']) {
        return printError('OUIJIT_PTY_ID not set — run from an Ouijit terminal');
      }
      const t = await get('/api/tasks/current');
      if (!t) return printError('Current terminal is not associated with a task');
      printJson(t);
    });

  task
    .command('create')
    .description('Create a todo task')
    .argument('<name>', 'task name')
    .option('--prompt <text>', 'task prompt/description')
    .action(async (name: string, opts: { prompt?: string }) => {
      const project = requireProject();
      const result = await post(`/api/tasks${projectQuery(project)}`, { name, prompt: opts.prompt });
      if (!(result as { success?: boolean }).success) return printError('Failed to create task');
      printJson(result);
    });

  task
    .command('start')
    .description('Start task (creates worktree)')
    .argument('<number>', 'task number')
    .option('--branch <name>', 'custom branch name')
    .option('--run-hook', 'run the configured start hook immediately, no dialog')
    .option('--skip-hook', 'spawn the terminal but run no hook')
    .option('--hook-command <cmd>', 'spawn the terminal running a one-off custom command')
    .action(async (number: string, opts: { branch?: string } & HookFlags) => {
      const num = parseInt(number, 10);
      if (isNaN(num)) return printError('Task number must be an integer');
      const hook = resolveHookFlags(opts);
      if ('error' in hook) return printError(hook.error);
      const project = requireProject();
      const result = await post(`/api/tasks/${num}/start${projectQuery(project)}`, {
        branchName: opts.branch,
        ...hook,
      });
      if (!(result as { success?: boolean }).success) {
        return printError((result as { error?: string }).error || 'Failed to start task');
      }
      printJson(result);
    });

  task
    .command('create-and-start')
    .alias('spawn')
    .description('Create + start in one step (alias: spawn)')
    .argument('<name>', 'task name')
    .option('--prompt <text>', 'task prompt/description')
    .option('--branch <name>', 'custom branch name')
    .option('--run-hook', 'run the configured start hook immediately, no dialog')
    .option('--skip-hook', 'spawn the terminal but run no hook')
    .option('--hook-command <cmd>', 'spawn the terminal running a one-off custom command')
    .action(async (name: string, opts: { prompt?: string; branch?: string } & HookFlags) => {
      const hook = resolveHookFlags(opts);
      if ('error' in hook) return printError(hook.error);
      const project = requireProject();
      const result = await post(`/api/tasks/start${projectQuery(project)}`, {
        name,
        prompt: opts.prompt,
        branchName: opts.branch,
        ...hook,
      });
      if (!(result as { success?: boolean }).success) {
        return printError((result as { error?: string }).error || 'Failed to create and start task');
      }
      printJson(result);
    });

  task
    .command('set-status')
    .description('Set task status')
    .argument('<number>', 'task number')
    .argument('<status>', 'new status (todo|in_progress|in_review|done)')
    .action(async (number: string, status: string) => {
      const num = parseInt(number, 10);
      if (isNaN(num)) return printError('Task number must be an integer');
      if (!VALID_STATUSES.includes(status)) {
        return printError(`Invalid status: ${status}. Must be one of: ${VALID_STATUSES.join(', ')}`);
      }
      const project = requireProject();
      const result = await patch<{ success: boolean; error?: string; hookWarning?: string }>(
        `/api/tasks/${num}/status${projectQuery(project)}`,
        { status },
      );
      if (!result.success) return printError(result.error || 'Failed to set status');
      printJson({ success: true, status: STATUS_LABELS[status] || status, hookWarning: result.hookWarning });
    });

  task
    .command('set-name')
    .description('Rename a task')
    .argument('<number>', 'task number')
    .argument('<name...>', 'new name')
    .action(async (number: string, nameParts: string[]) => {
      const num = parseInt(number, 10);
      const name = nameParts.join(' ');
      if (isNaN(num) || !name) return printError('Usage: ouijit task set-name <number> <name>');
      const project = requireProject();
      const result = await patch(`/api/tasks/${num}/name${projectQuery(project)}`, { name });
      printJson(result);
    });

  task
    .command('set-description')
    .description('Set task description')
    .argument('<number>', 'task number')
    .argument('<text...>', 'description text')
    .action(async (number: string, textParts: string[]) => {
      const num = parseInt(number, 10);
      const desc = textParts.join(' ');
      if (isNaN(num) || !desc) return printError('Usage: ouijit task set-description <number> <text>');
      const project = requireProject();
      const result = await patch(`/api/tasks/${num}/description${projectQuery(project)}`, { description: desc });
      printJson(result);
    });

  task
    .command('set-merge-target')
    .description('Set merge target branch')
    .argument('<number>', 'task number')
    .argument('<branch>', 'target branch')
    .action(async (number: string, branch: string) => {
      const num = parseInt(number, 10);
      if (isNaN(num)) return printError('Task number must be an integer');
      const project = requireProject();
      const result = await patch(`/api/tasks/${num}/merge-target${projectQuery(project)}`, { mergeTarget: branch });
      printJson(result);
    });

  task
    .command('delete')
    .description('Delete task and its worktree')
    .argument('<number>', 'task number')
    .action(async (number: string) => {
      const num = parseInt(number, 10);
      if (isNaN(num)) return printError('Task number must be an integer');
      const project = requireProject();
      const result = await del(`/api/tasks/${num}${projectQuery(project)}`);
      printJson(result);
    });
}
