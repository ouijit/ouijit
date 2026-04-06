/**
 * CLI task commands — full task lifecycle.
 */

import type { Command } from 'commander';
import {
  getProjectTasks,
  getTaskByNumber,
  setTaskStatus,
  setTaskName,
  setTaskDescription,
  setTaskMergeTarget,
  getHook,
  type TaskStatus,
} from '../../db';
import { createTodoTask, startTask, createTaskWorktree } from '../../worktree';
import { deleteTaskWithWorktree } from '../../taskLifecycle';
import { executeHook } from '../../hookRunner';
import type { HookType } from '../../db/repos/hookRepo';
import { printJson, printError } from '../output';
import { notify } from '../notify';

const VALID_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'in_review', 'done'];

const STATUS_LABELS: Record<string, string> = {
  todo: 'Todo',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
};

function statusToHookType(status: TaskStatus, hasWorktree: boolean): HookType | null {
  if (status === 'in_progress') return hasWorktree ? 'continue' : 'start';
  if (status === 'in_review') return 'review';
  if (status === 'done') return 'cleanup';
  return null;
}

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
      const tasks = await getProjectTasks(project);
      printJson(tasks);
    });

  task
    .command('get')
    .description('Get task by number')
    .argument('<number>', 'task number')
    .action(async (number: string) => {
      const project = requireProject();
      const num = parseInt(number, 10);
      if (isNaN(num)) printError('Task number must be an integer');
      const t = await getTaskByNumber(project, num);
      if (!t) printError(`Task ${num} not found`);
      printJson(t);
    });

  task
    .command('create')
    .description('Create a todo task')
    .argument('<name>', 'task name')
    .option('--prompt <text>', 'task prompt/description')
    .action(async (name: string, opts: { prompt?: string }) => {
      const project = requireProject();
      const result = await createTodoTask(project, name, opts.prompt);
      if (!result.success) printError(result.error || 'Failed to create task');
      notify(project, 'task:create', `Task created: ${name}`);
      printJson(result);
    });

  task
    .command('start')
    .description('Start task (creates worktree)')
    .argument('<number>', 'task number')
    .option('--branch <name>', 'custom branch name')
    .action(async (number: string, opts: { branch?: string }) => {
      const project = requireProject();
      const num = parseInt(number, 10);
      if (isNaN(num)) printError('Task number must be an integer');
      const result = await startTask(project, num, opts.branch);
      if (!result.success) printError(result.error || 'Failed to start task');
      notify(project, 'task:start', `Task #${num} started`);
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
      const result = await createTaskWorktree(project, name, opts.prompt, opts.branch);
      if (!result.success) printError(result.error || 'Failed to create and start task');
      notify(project, 'task:create-and-start', `Task created and started: ${name}`);
      printJson(result);
    });

  task
    .command('set-status')
    .description('Set task status')
    .argument('<number>', 'task number')
    .argument('<status>', 'new status (todo|in_progress|in_review|done)')
    .action(async (number: string, status: string) => {
      const project = requireProject();
      const num = parseInt(number, 10);
      if (isNaN(num)) printError('Task number must be an integer');
      if (!VALID_STATUSES.includes(status as TaskStatus)) {
        printError(`Invalid status: ${status}. Must be one of: ${VALID_STATUSES.join(', ')}`);
      }
      const s = status as TaskStatus;
      const statusResult = await setTaskStatus(project, num, s);
      if (!statusResult.success) printError(statusResult.error || 'Failed to set status');

      // Execute hook if applicable
      const t = await getTaskByNumber(project, num);
      const hookType = statusToHookType(s, !!t?.worktreePath);
      let hookResult: { ran: boolean; type?: string; exitCode?: number; output?: string } = { ran: false };

      if (hookType && t?.worktreePath) {
        const hook = await getHook(project, hookType);
        if (hook) {
          const result = await executeHook(hook, t.worktreePath, {
            projectPath: project,
            worktreePath: t.worktreePath,
            taskBranch: t.branch || '',
            taskName: t.name,
            taskPrompt: t.prompt,
          });
          hookResult = { ran: true, type: hookType, exitCode: result.exitCode, output: result.output };
        }
      }

      notify(project, 'task:set-status', `Task #${num} → ${STATUS_LABELS[s] || s}`);
      printJson({ success: true, task: t, hook: hookResult });
    });

  task
    .command('set-name')
    .description('Rename a task')
    .argument('<number>', 'task number')
    .argument('<name...>', 'new name')
    .action(async (number: string, nameParts: string[]) => {
      const project = requireProject();
      const num = parseInt(number, 10);
      const name = nameParts.join(' ');
      if (isNaN(num) || !name) printError('Usage: ouijit task set-name <number> <name>');
      const result = await setTaskName(project, num, name);
      if (!result.success) printError(result.error || 'Failed to set name');
      notify(project, 'task:set-name', `Task #${num} renamed to "${name}"`);
      printJson(result);
    });

  task
    .command('set-description')
    .description('Set task description')
    .argument('<number>', 'task number')
    .argument('<text...>', 'description text')
    .action(async (number: string, textParts: string[]) => {
      const project = requireProject();
      const num = parseInt(number, 10);
      const desc = textParts.join(' ');
      if (isNaN(num) || !desc) printError('Usage: ouijit task set-description <number> <text>');
      const result = await setTaskDescription(project, num, desc);
      if (!result.success) printError(result.error || 'Failed to set description');
      notify(project, 'task:set-description', `Task #${num} description updated`);
      printJson(result);
    });

  task
    .command('set-merge-target')
    .description('Set merge target branch')
    .argument('<number>', 'task number')
    .argument('<branch>', 'target branch')
    .action(async (number: string, branch: string) => {
      const project = requireProject();
      const num = parseInt(number, 10);
      if (isNaN(num)) printError('Task number must be an integer');
      const result = await setTaskMergeTarget(project, num, branch);
      if (!result.success) printError(result.error || 'Failed to set merge target');
      notify(project, 'task:set-merge-target', `Task #${num} merge target → ${branch}`);
      printJson(result);
    });

  task
    .command('delete')
    .description('Delete task and its worktree')
    .argument('<number>', 'task number')
    .action(async (number: string) => {
      const project = requireProject();
      const num = parseInt(number, 10);
      if (isNaN(num)) printError('Task number must be an integer');
      const result = await deleteTaskWithWorktree(project, num);
      if (!result.success) printError(result.error || 'Failed to delete task');
      notify(project, 'task:delete', `Task #${num} deleted`);
      printJson(result);
    });
}
