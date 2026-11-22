/**
 * CLI chat commands — read a chat card's conversation and send it messages
 * through the REST API.
 */

import type { Command } from 'commander';
import { del, get, post, put, projectQuery } from '../api';
import { printError, printJson, readBody } from '../output';
import { resolvePtyId } from '../ptyId';
import { SANDBOX_FLAG, parseSandboxFlag, sandboxFlagHelp } from '../sandboxFlag';

function chatUrl(id: string): string {
  return `/api/chats/${encodeURIComponent(id)}`;
}

export function registerChatCommands(parent: Command, requireProject: () => Promise<string>) {
  const chat = parent
    .command('chat')
    .description('Read and message chat sessions')
    .addHelpText(
      'after',
      `
Examples:
  ouijit chat list
  ouijit chat open --task 12 --prompt "add tests for the session timeout"
  echo "a longer first message" | ouijit chat open --task 12 --prompt -
  ouijit chat read pty_abc123
  ouijit chat read pty_abc123 --after 42
  ouijit chat read pty_abc123 --after 42 --wait 25
  ouijit chat answer pty_abc123 claude-approval-toolu_1 --option allow
  ouijit chat answer pty_abc123 codex-input-7 --answer q1=yes
  ouijit chat send pty_abc123 "also update the docs"
  echo "a longer message" | ouijit chat send pty_abc123 -
  ouijit chat interrupt pty_abc123
  ouijit chat follow 12 --project ~/code/app
  ouijit chat unfollow 12 --project ~/code/app
  ouijit chat following`,
    );

  chat
    .command('list')
    .description('List running chat sessions')
    .action(async () => {
      printJson(await get('/api/chats'));
    });

  chat
    .command('open')
    .description("Open a new chat on a started task, in its worktree, without changing what's on screen")
    .requiredOption('--task <number>', 'the task, which must already be started')
    .option('--prompt <text>', 'its first message, sent once the agent is up, or - to read it from stdin')
    .option('--from <chat-id>', 'another chat on the task, whose conversation so far it starts from')
    .option('--agent <agent>', 'claude, codex, pi, opencode or acp; omitted, the chat setting')
    .option(SANDBOX_FLAG, sandboxFlagHelp('where it runs; omitted, as the task menu would open it'))
    .action(async (opts: { task: string; prompt?: string; from?: string; agent?: string; sandbox?: string }) => {
      const parsed = parseSandboxFlag(opts.sandbox);
      if ('error' in parsed) return printError(parsed.error);
      const task = parseInt(opts.task, 10);
      if (isNaN(task)) return printError('Task number must be an integer');
      const prompt = opts.prompt === undefined ? undefined : await readBody(opts.prompt);
      printJson(
        await post(`/api/chats${projectQuery(await requireProject())}`, {
          task,
          ...(prompt && { prompt }),
          ...(opts.from && { from: opts.from }),
          ...(opts.agent && { agent: opts.agent }),
          ...(parsed.sandbox && { sandbox: parsed.sandbox }),
        }),
      );
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

  const target = async (taskOrChat: string): Promise<string> =>
    /^\d+$/.test(taskOrChat)
      ? `/api/following/tasks/${taskOrChat}${projectQuery(await requireProject())}`
      : `/api/following/chats/${encodeURIComponent(taskOrChat)}`;

  chat
    .command('follow')
    .description('Chat only: hear what happens to a task, or a chat with no task, until it is done or unfollowed')
    .argument('<task-or-chat>', 'a task number, or a chat session id')
    .action(async (taskOrChat: string) => {
      printJson(await put(await target(taskOrChat), {}));
    });

  chat
    .command('unfollow')
    .description('Chat only: stop hearing about a task or chat')
    .argument('<task-or-chat>', 'a task number, or a chat session id')
    .action(async (taskOrChat: string) => {
      printJson(await del(await target(taskOrChat)));
    });

  chat
    .command('following')
    .description('Chat only: the tasks and chats this conversation follows')
    .action(async () => {
      printJson(await get('/api/following'));
    });

  chat
    .command('interrupt')
    .description("Stop a chat's running turn")
    .argument('<pty-id>', 'chat session id')
    .action(async (id: string) => {
      printJson(await post(`${chatUrl(id)}/interrupt`));
    });
}
