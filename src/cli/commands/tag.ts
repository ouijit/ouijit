/**
 * CLI tag commands — CRUD for task tags.
 */

import type { Command } from 'commander';
import { getAllTags, getTaskTags, addTagToTask, removeTagFromTask, setTaskTags } from '../../db';
import { printJson, printError } from '../output';
import { notify } from '../notify';

export function registerTagCommands(parent: Command, requireProject: () => string) {
  const tag = parent
    .command('tag')
    .description('Manage task tags')
    .addHelpText(
      'after',
      `
Examples:
  ouijit tag list
  ouijit tag add 5 bug
  ouijit tag remove 5 bug
  ouijit tag set 5 bug priority`,
    );

  tag
    .command('list')
    .description('List all tags, or tags for a specific task')
    .option('--task <number>', 'filter by task number')
    .action(async (opts: { task?: string }) => {
      if (opts.task) {
        const project = requireProject();
        const taskNumber = parseInt(opts.task, 10);
        if (isNaN(taskNumber)) return printError('--task must be a number');
        const tags = await getTaskTags(project, taskNumber);
        printJson(tags);
      } else {
        const tags = await getAllTags();
        printJson(tags);
      }
    });

  tag
    .command('add')
    .description('Add tag to task')
    .argument('<task-number>', 'task number')
    .argument('<tag-name>', 'tag name')
    .action(async (taskNumber: string, tagName: string) => {
      const project = requireProject();
      const num = parseInt(taskNumber, 10);
      if (isNaN(num)) return printError('Task number must be an integer');
      const t = await addTagToTask(project, num, tagName);
      notify(project, 'tag:add', `Tag "${tagName}" added to task #${num}`);
      printJson(t);
    });

  tag
    .command('remove')
    .description('Remove tag from task')
    .argument('<task-number>', 'task number')
    .argument('<tag-name>', 'tag name')
    .action(async (taskNumber: string, tagName: string) => {
      const project = requireProject();
      const num = parseInt(taskNumber, 10);
      if (isNaN(num)) return printError('Task number must be an integer');
      await removeTagFromTask(project, num, tagName);
      notify(project, 'tag:remove', `Tag "${tagName}" removed from task #${num}`);
      printJson({ success: true });
    });

  tag
    .command('set')
    .description('Replace all tags on a task')
    .argument('<task-number>', 'task number')
    .argument('<tags...>', 'tag names')
    .action(async (taskNumber: string, tagNames: string[]) => {
      const project = requireProject();
      const num = parseInt(taskNumber, 10);
      if (isNaN(num)) return printError('Task number must be an integer');
      const tags = await setTaskTags(project, num, tagNames);
      notify(project, 'tag:set', `Tags updated on task #${num}`);
      printJson(tags);
    });
}
