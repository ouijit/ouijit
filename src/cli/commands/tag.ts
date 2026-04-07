/**
 * CLI tag commands — CRUD for task tags via REST API.
 */

import type { Command } from 'commander';
import { get, post, put, del, projectQuery } from '../api';
import { printJson, printError } from '../output';

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
        const tags = await get(`/api/tasks/${taskNumber}/tags${projectQuery(project)}`);
        printJson(tags);
      } else {
        const tags = await get('/api/tags');
        printJson(tags);
      }
    });

  tag
    .command('add')
    .description('Add tag to task')
    .argument('<task-number>', 'task number')
    .argument('<tag-name>', 'tag name')
    .action(async (taskNumber: string, tagName: string) => {
      const num = parseInt(taskNumber, 10);
      if (isNaN(num)) return printError('Task number must be an integer');
      const project = requireProject();
      const t = await post(`/api/tasks/${num}/tags${projectQuery(project)}`, { name: tagName });
      printJson(t);
    });

  tag
    .command('remove')
    .description('Remove tag from task')
    .argument('<task-number>', 'task number')
    .argument('<tag-name>', 'tag name')
    .action(async (taskNumber: string, tagName: string) => {
      const num = parseInt(taskNumber, 10);
      if (isNaN(num)) return printError('Task number must be an integer');
      const project = requireProject();
      await del(`/api/tasks/${num}/tags/${encodeURIComponent(tagName)}${projectQuery(project)}`);
      printJson({ success: true });
    });

  tag
    .command('set')
    .description('Replace all tags on a task')
    .argument('<task-number>', 'task number')
    .argument('<tags...>', 'tag names')
    .action(async (taskNumber: string, tagNames: string[]) => {
      const num = parseInt(taskNumber, 10);
      if (isNaN(num)) return printError('Task number must be an integer');
      const project = requireProject();
      const tags = await put(`/api/tasks/${num}/tags${projectQuery(project)}`, { tags: tagNames });
      printJson(tags);
    });
}
