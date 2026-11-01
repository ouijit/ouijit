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
  ouijit chat read pty_abc123 --after 42 --wait 25
  ouijit chat answer pty_abc123 claude-approval-toolu_1 --option allow
  ouijit chat answer pty_abc123 codex-input-7 --answer q1=yes
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
    .option('--wait <seconds>', 'with --after, wait up to this long (max 30) for the next event')
    .action(async (explicitId: string | undefined, options: { after?: string; wait?: string }) => {
      const params = new URLSearchParams();
      if (options.after) params.set('after', options.after);
      if (options.after && options.wait) params.set('wait', options.wait);
      const query = params.size ? `?${params}` : '';
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
    .command('answer')
    .description('Answer an approval or question a chat is waiting on; a chat cannot answer its own')
    .argument('<pty-id>', 'chat session id')
    .argument('<request-id>', 'from the pending list of `chat read`')
    .option('--option <id>', 'pick one of the request options')
    .option('--message <text>', 'with --option, a note for the agent')
    .option('--answer <id=value...>', 'answer questions by id')
    .option('--cancel', 'dismiss the request')
    .action(
      async (
        id: string,
        requestId: string,
        options: { option?: string; message?: string; answer?: string[]; cancel?: boolean },
      ) => {
        const body: Record<string, unknown> = {};
        if (options.option) body.option = options.option;
        if (options.message) body.message = options.message;
        if (options.cancel) body.cancel = true;
        if (options.answer) {
          const answers: Record<string, string[]> = {};
          for (const pair of options.answer) {
            const split = pair.indexOf('=');
            const key = split === -1 ? pair : pair.slice(0, split);
            (answers[key] ??= []).push(split === -1 ? '' : pair.slice(split + 1));
          }
          body.answers = answers;
        }
        printJson(await post(`${chatUrl(id)}/requests/${encodeURIComponent(requestId)}`, body));
      },
    );

  chat
    .command('interrupt')
    .description("Stop a chat's running turn")
    .argument('<pty-id>', 'chat session id')
    .action(async (id: string) => {
      printJson(await post(`${chatUrl(id)}/interrupt`));
    });
}
