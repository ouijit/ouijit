/**
 * CLI diff commands via REST API.
 */

import type { Command } from 'commander';
import { get, post, del, projectQuery } from '../api';
import { resolvePtyId } from '../ptyId';
import { printJson, printError } from '../output';

export function registerDiffCommands(parent: Command, requireProject: () => string) {
  const diff = parent
    .command('diff')
    .description("Read the notes on a worktree's diff, and show or hide a terminal's diff")
    .addHelpText(
      'after',
      `
Examples:
  ouijit diff notes
  ouijit diff notes --task 5
  ouijit diff open
  ouijit diff close`,
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

  diff
    .command('open')
    .description("Show a terminal's diff panel")
    .argument('[pty-id]', 'terminal session id (defaults to OUIJIT_PTY_ID)')
    .action(async (explicitPtyId?: string) => {
      printJson(await post(`/api/terminals/${encodeURIComponent(resolvePtyId(explicitPtyId))}/diff`, {}));
    });

  diff
    .command('close')
    .description("Hide a terminal's diff panel")
    .argument('[pty-id]', 'terminal session id (defaults to OUIJIT_PTY_ID)')
    .action(async (explicitPtyId?: string) => {
      printJson(await del(`/api/terminals/${encodeURIComponent(resolvePtyId(explicitPtyId))}/diff`));
    });
}
