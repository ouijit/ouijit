/**
 * CLI session commands via REST API: what runs on a card, a terminal or a
 * chat, read, pasted into and closed the same way.
 */

import type { Command } from 'commander';
import { get, post, del, projectQuery } from '../api';
import { printJson, printError, readBody } from '../output';

function sessionUrl(sessionId: string): string {
  return `/api/terminals/${encodeURIComponent(sessionId)}`;
}

export function registerSessionCommands(parent: Command, requireProject: () => Promise<string>) {
  const session = parent
    .command('session')
    .description('See the terminals and chats open on cards, read them, paste into them and close them')
    .addHelpText(
      'after',
      `
Examples:
  ouijit session list
  ouijit session list --task 5
  ouijit session read pty_abc123 --lines 40
  ouijit session paste pty_abc123 "run the tests again"
  ouijit session paste pty_abc123 - < followup.md
  ouijit session close pty_abc123`,
    );

  session
    .command('list')
    .description("List the open sessions in every project, with each one's kind, task, sandbox and agent status")
    .option('--task <number>', "only this task's, in this terminal's project or --project's")
    .action(async (opts: { task?: string }) => {
      if (opts.task === undefined) return printJson(await get('/api/terminals'));
      const task = parseInt(opts.task, 10);
      if (isNaN(task)) return printError('Task number must be an integer');
      printJson(await get(`/api/tasks/${task}/sessions${projectQuery(await requireProject())}`));
    });

  session
    .command('read')
    .description("Show a session's screen and recent scrollback, or a chat's transcript, as text")
    .argument('<session-id>', 'session id')
    .option('--lines <n>', 'how many lines from the bottom (default 100)')
    .action(async (sessionId: string, opts: { lines?: string }) => {
      const query = opts.lines === undefined ? '' : `?lines=${encodeURIComponent(opts.lines)}`;
      printJson(await get(`${sessionUrl(sessionId)}/screen${query}`));
    });

  session
    .command('paste')
    .description("Paste text into a session's prompt without pressing Enter, so a person sends it")
    .argument('<session-id>', 'session id')
    .argument('<text>', 'the text, or - to read stdin')
    .action(async (sessionId: string, text: string) => {
      printJson(await post(`${sessionUrl(sessionId)}/paste`, { text: await readBody(text) }));
    });

  session
    .command('close')
    .description('Close a session')
    .argument('<session-id>', 'session id')
    .action(async (sessionId: string) => {
      printJson(await del(sessionUrl(sessionId)));
    });
}
