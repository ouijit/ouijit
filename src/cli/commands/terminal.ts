/**
 * CLI terminal command via REST API: opening one. A terminal open is a
 * session, read and closed with `ouijit session`.
 */

import type { Command } from 'commander';
import { post, projectQuery } from '../api';
import { printJson, printError } from '../output';
import { SANDBOX_FLAG, parseSandboxFlag, sandboxFlagHelp } from '../sandboxFlag';

export function registerTerminalCommands(parent: Command, requireProject: () => Promise<string>) {
  const terminal = parent
    .command('terminal')
    .description('Open a terminal')
    .addHelpText(
      'after',
      `
Examples:
  ouijit terminal open --task 5
  ouijit terminal open --task 5 --resume`,
    );

  terminal
    .command('open')
    .description("Open a terminal in a task's worktree, or a shell in the project, without changing what's on screen")
    .option('--task <number>', "open it in this task's worktree")
    .option('--resume', "run the project's continue hook in it, as reopening the task does")
    .option(SANDBOX_FLAG, sandboxFlagHelp('where it runs; omitted, the project default'))
    .action(async (opts: { task?: string; resume?: boolean; sandbox?: string }) => {
      const parsed = parseSandboxFlag(opts.sandbox);
      if ('error' in parsed) return printError(parsed.error);
      const task = opts.task === undefined ? undefined : parseInt(opts.task, 10);
      if (task !== undefined && isNaN(task)) return printError('Task number must be an integer');
      if (opts.resume && task === undefined) return printError('--resume needs --task');
      const opened = await post(`/api/terminals${projectQuery(await requireProject())}`, {
        ...(task !== undefined && { task }),
        ...(opts.resume && { resume: true }),
        ...(parsed.sandbox && { sandbox: parsed.sandbox }),
      });
      printJson(opened);
    });
}
