/**
 * CLI chat commands — read a chat card's conversation and send it messages
 * through the REST API.
 */

import type { Command } from 'commander';
import { get, post } from '../api';
import { printJson, readBody } from '../output';
import { resolvePtyId } from '../ptyId';

function chatUrl(id: string): string {
  return `/api/chats/${encodeURIComponent(id)}`;
}

export function registerChatCommands(parent: Command) {
  const chat = parent
    .command('chat')
    .description('Read and message chat sessions')
    .addHelpText(
      'after',
      `
Examples:
  ouijit chat list
  ouijit chat read pty_abc123
  ouijit chat read pty_abc123 --after 42
  ouijit chat send pty_abc123 "also update the docs"
  echo "a longer message" | ouijit chat send pty_abc123 -
  ouijit chat interrupt pty_abc123`,
    );

  chat
    .command('list')
    .description('List running chat sessions')
    .action(async () => {
      printJson(await get('/api/chats'));
    });

  chat
    .command('read')
    .description('Show a chat: its status, transcript as text, and anything waiting on a person')
    .argument('[pty-id]', 'chat session id (defaults to OUIJIT_PTY_ID)')
    .option('--after <seq>', 'only the events after this sequence number')
    .action(async (explicitId: string | undefined, options: { after?: string }) => {
      const query = options.after ? `?after=${encodeURIComponent(options.after)}` : '';
      printJson(await get(`${chatUrl(resolvePtyId(explicitId))}${query}`));
    });

  chat
    .command('send')
    .description('Send a chat a message; while it works, the message steers the turn or queues')
    .argument('<pty-id>', 'chat session id')
    .argument('<text>', 'the message, or - to read it from stdin')
    .option('--queue', 'wait for the running turn to end instead of steering it')
    .action(async (id: string, text: string, options: { queue?: boolean }) => {
      const body = await readBody(text);
      printJson(await post(`${chatUrl(id)}/messages`, { text: body, ...(options.queue && { delivery: 'queue' }) }));
    });

  chat
    .command('interrupt')
    .description("Stop a chat's running turn")
    .argument('<pty-id>', 'chat session id')
    .action(async (id: string) => {
      printJson(await post(`${chatUrl(id)}/interrupt`));
    });
}
