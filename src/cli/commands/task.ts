/**
 * CLI task commands — full task lifecycle.
 */

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

/** Extract positional args from rest, skipping --flag value pairs. */
function positionalArgs(args: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      i++; // skip the flag's value
    } else {
      result.push(args[i]);
    }
  }
  return result;
}

function statusToHookType(status: TaskStatus, hasWorktree: boolean): HookType | null {
  if (status === 'in_progress') return hasWorktree ? 'continue' : 'start';
  if (status === 'in_review') return 'review';
  if (status === 'done') return 'cleanup';
  return null;
}

export async function handleTaskCommand(
  action: string | undefined,
  rest: string[],
  flags: Record<string, string>,
  requireProject: () => string,
): Promise<void> {
  switch (action) {
    case 'list': {
      const project = requireProject();
      const tasks = await getProjectTasks(project);
      printJson(tasks);
      break;
    }

    case 'get': {
      const project = requireProject();
      const num = parseInt(rest[0], 10);
      if (isNaN(num)) printError('Usage: ouijit task get <number>');
      const task = await getTaskByNumber(project, num);
      if (!task) printError(`Task ${num} not found`);
      printJson(task);
      break;
    }

    case 'create': {
      const project = requireProject();
      const name = flags.name || positionalArgs(rest).join(' ') || undefined;
      const result = await createTodoTask(project, name, flags.prompt);
      if (!result.success) printError(result.error || 'Failed to create task');
      notify(project, 'task:create', `Task created: ${name || 'Untitled'}`);
      printJson(result);
      break;
    }

    case 'start': {
      const project = requireProject();
      const num = parseInt(rest[0], 10);
      if (isNaN(num)) printError('Usage: ouijit task start <number> [--branch <name>]');
      const result = await startTask(project, num, flags.branch);
      if (!result.success) printError(result.error || 'Failed to start task');
      notify(project, 'task:start', `Task #${num} started`);
      printJson(result);
      break;
    }

    case 'create-and-start': {
      const project = requireProject();
      const name = flags.name || positionalArgs(rest).join(' ') || undefined;
      const result = await createTaskWorktree(project, name, flags.prompt, flags.branch);
      if (!result.success) printError(result.error || 'Failed to create and start task');
      notify(project, 'task:create-and-start', `Task created and started: ${name || 'Untitled'}`);
      printJson(result);
      break;
    }

    case 'set-status': {
      const project = requireProject();
      const num = parseInt(rest[0], 10);
      const status = rest[1] as TaskStatus;
      if (isNaN(num) || !VALID_STATUSES.includes(status)) {
        printError('Usage: ouijit task set-status <number> <todo|in_progress|in_review|done>');
      }
      const statusResult = await setTaskStatus(project, num, status);
      if (!statusResult.success) printError(statusResult.error || 'Failed to set status');

      // Execute hook if applicable
      const task = await getTaskByNumber(project, num);
      const hookType = statusToHookType(status, !!task?.worktreePath);
      let hookResult: { ran: boolean; type?: string; exitCode?: number; output?: string } = { ran: false };

      if (hookType && task?.worktreePath) {
        const hook = await getHook(project, hookType);
        if (hook) {
          const result = await executeHook(hook, task.worktreePath, {
            projectPath: project,
            worktreePath: task.worktreePath,
            taskBranch: task.branch || '',
            taskName: task.name,
            taskPrompt: task.prompt,
          });
          hookResult = { ran: true, type: hookType, exitCode: result.exitCode, output: result.output };
        }
      }

      const statusLabels: Record<string, string> = {
        todo: 'Todo',
        in_progress: 'In Progress',
        in_review: 'In Review',
        done: 'Done',
      };
      notify(project, 'task:set-status', `Task #${num} → ${statusLabels[status] || status}`);
      printJson({ success: true, task, hook: hookResult });
      break;
    }

    case 'set-name': {
      const project = requireProject();
      const num = parseInt(rest[0], 10);
      const name = rest
        .slice(1)
        .filter((s) => !s.startsWith('--'))
        .join(' ');
      if (isNaN(num) || !name) printError('Usage: ouijit task set-name <number> <name>');
      const result = await setTaskName(project, num, name);
      if (!result.success) printError(result.error || 'Failed to set name');
      notify(project, 'task:set-name', `Task #${num} renamed to "${name}"`);
      printJson(result);
      break;
    }

    case 'set-description': {
      const project = requireProject();
      const num = parseInt(rest[0], 10);
      const desc = rest
        .slice(1)
        .filter((s) => !s.startsWith('--'))
        .join(' ');
      if (isNaN(num) || !desc) printError('Usage: ouijit task set-description <number> <description>');
      const result = await setTaskDescription(project, num, desc);
      if (!result.success) printError(result.error || 'Failed to set description');
      notify(project, 'task:set-description', `Task #${num} description updated`);
      printJson(result);
      break;
    }

    case 'set-merge-target': {
      const project = requireProject();
      const num = parseInt(rest[0], 10);
      const branch = rest[1];
      if (isNaN(num) || !branch) printError('Usage: ouijit task set-merge-target <number> <branch>');
      const result = await setTaskMergeTarget(project, num, branch);
      if (!result.success) printError(result.error || 'Failed to set merge target');
      notify(project, 'task:set-merge-target', `Task #${num} merge target → ${branch}`);
      printJson(result);
      break;
    }

    case 'delete': {
      const project = requireProject();
      const num = parseInt(rest[0], 10);
      if (isNaN(num)) printError('Usage: ouijit task delete <number>');
      const result = await deleteTaskWithWorktree(project, num);
      if (!result.success) printError(result.error || 'Failed to delete task');
      notify(project, 'task:delete', `Task #${num} deleted`);
      printJson(result);
      break;
    }

    case 'help':
      process.stderr.write(`ouijit task — manage tasks

Actions:
  list                                       List all tasks (JSON array)
  get <number>                               Get task by number
  create <name> [--prompt <text>]            Create a todo task
  start <number> [--branch <name>]           Start task (creates worktree)
  create-and-start <name> [--prompt <text>]  Create + start in one step
  set-status <number> <status>               Set status (todo|in_progress|in_review|done)
  set-name <number> <name>                   Rename a task
  set-description <number> <text>            Set task description
  set-merge-target <number> <branch>         Set merge target branch
  delete <number>                            Delete task and its worktree

Examples:
  ouijit task create "Fix login bug"
  ouijit task create "Refactor auth" --prompt "Extract auth middleware"
  ouijit task start 5
  ouijit task set-status 5 in_review
  ouijit task list
`);
      process.exit(0);
      break;

    default:
      printError(
        'Usage: ouijit task <list|get|create|start|create-and-start|set-status|set-name|set-description|set-merge-target|delete>\nRun "ouijit task --help" for details.',
      );
  }
}
