/**
 * CLI diff commands via REST API.
 */

import type { Command } from 'commander';
import { get, projectQuery } from '../api';
import { printJson, printError } from '../output';

export function registerDiffCommands(parent: Command, requireProject: () => string) {
  const diff = parent
    .command('diff')
    .description("Read what's been written on a worktree's diff")
    .addHelpText(
      'after',
      `
Examples:
  ouijit diff notes
  ouijit diff notes --task 5`,
    );

  diff
    .command('notes')
    .description("List the notes left on this terminal's worktree diff, or on a task's")
    .option('--task <number>', "read a task's worktree instead of this terminal's")
    .action(async (opts: { task?: string }) => {
      if (opts.task === undefined) {
        printJson(await get('/api/diff-notes'));
        return;
      }
      const num = parseInt(opts.task, 10);
      if (isNaN(num)) return printError('Task number must be an integer');
      printJson(await get(`/api/tasks/${num}/diff-notes${projectQuery(requireProject())}`));
    });
}
