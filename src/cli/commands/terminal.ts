/**
 * CLI terminal commands via REST API.
 */

import type { Command } from 'commander';
import { get, post, del, projectQuery } from '../api';
import { printJson, printError, readBody } from '../output';
import { SANDBOX_FLAG, parseSandboxFlag, sandboxFlagHelp } from '../sandboxFlag';

function terminalUrl(ptyId: string): string {
  return `/api/terminals/${encodeURIComponent(ptyId)}`;
}

export function registerTerminalCommands(parent: Command, requireProject: () => string) {
  const terminal = parent
    .command('terminal')
    .description('See, open and close terminals, and paste into them')
    .addHelpText(
      'after',
      `
Examples:
  ouijit terminal list
  ouijit terminal read pty_abc123 --lines 40
  ouijit terminal open --task 5
  ouijit terminal paste pty_abc123 "run the tests again"
  ouijit terminal paste pty_abc123 - < followup.md
  ouijit terminal close pty_abc123`,
    );

  terminal
    .command('list')
    .description("List open terminals in every project, with each one's task, sandbox and agent status")
    .action(async () => {
      printJson(await get('/api/terminals'));
    });

  terminal
    .command('read')
    .description("Show a terminal's screen and recent scrollback, as text")
    .argument('<pty-id>', 'terminal session id')
    .option('--lines <n>', 'how many lines from the bottom (default 100)')
    .action(async (ptyId: string, opts: { lines?: string }) => {
      const query = opts.lines === undefined ? '' : `?lines=${encodeURIComponent(opts.lines)}`;
      printJson(await get(`${terminalUrl(ptyId)}/screen${query}`));
    });

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
      printJson(
        await post(`/api/terminals${projectQuery(requireProject())}`, {
          ...(task !== undefined && { task }),
          ...(opts.resume && { resume: true }),
          ...(parsed.sandbox && { sandbox: parsed.sandbox }),
        }),
      );
    });

  terminal
    .command('paste')
    .description("Paste text into a terminal's prompt without pressing Enter, so a person sends it")
    .argument('<pty-id>', 'terminal session id')
    .argument('<text>', 'the text, or - to read stdin')
    .action(async (ptyId: string, text: string) => {
      printJson(await post(`${terminalUrl(ptyId)}/paste`, { text: await readBody(text) }));
    });

  terminal
    .command('close')
    .description('Close a terminal')
    .argument('<pty-id>', 'terminal session id')
    .action(async (ptyId: string) => {
      printJson(await del(terminalUrl(ptyId)));
    });
}
