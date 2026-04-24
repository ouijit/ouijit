/**
 * CLI task commands — full task lifecycle via REST API.
 */

import type { Command } from 'commander';
import { get, post, patch, del, projectQuery } from '../api';
import { printJson, printError } from '../output';

const VALID_STATUSES = ['todo', 'in_progress', 'in_review', 'done'];

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
    .action(async (number: string, opts: { branch?: string }) => {
      const num = parseInt(number, 10);
      if (isNaN(num)) return printError('Task number must be an integer');
      const project = requireProject();
      const result = await post(`/api/tasks/${num}/start${projectQuery(project)}`, { branchName: opts.branch });
      if (!(result as { success?: boolean }).success) {
        return printError((result as { error?: string }).error || 'Failed to start task');
      }
      printJson(result);
    });

  task
    .command('create-and-start')
    .description('Create + start in one step')
    .argument('<name>', 'task name')
    .option('--prompt <text>', 'task prompt/description')
    .option('--branch <name>', 'custom branch name')
    .action(async (name: string, opts: { prompt?: string; branch?: string }) => {
      const project = requireProject();
      const result = await post(`/api/tasks/start${projectQuery(project)}`, {
        name,
        prompt: opts.prompt,
        branchName: opts.branch,
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
