/**
 * CLI hook commands — CRUD for script hooks via REST API.
 */

import type { Command } from 'commander';
import { get, put, del, projectQuery } from '../api';
import { printJson, printError, readBody } from '../output';
import { SANDBOX_FLAG, parseSandboxFlag, sandboxFlagHelp } from '../sandboxFlag';
import { SANDBOXABLE_HOOK_TYPES, isActiveSandbox } from '../../sandbox/types';

const VALID_HOOK_TYPES = ['start', 'continue', 'run', 'review', 'done', 'editor'];

function validateHookType(type: string): string {
  if (!VALID_HOOK_TYPES.includes(type)) {
    return printError(`Invalid hook type: ${type}. Must be one of: ${VALID_HOOK_TYPES.join(', ')}`);
  }
  return type;
}

export function registerHookCommands(parent: Command, requireProject: () => Promise<string>) {
  const hook = parent
    .command('hook')
    .description('Manage script hooks')
    .addHelpText(
      'after',
      `
Hook types: start, continue, run, review, done, editor

Examples:
  ouijit hook list
  ouijit hook set start --name "Install deps" --command "npm install"
  ouijit hook set start --name "Claude" --command "claude" --sandbox custom
  ouijit hook get review
  ouijit hook delete done
  ouijit hook chat-start set --setup "npm install" --first-message 'Read PLAN.md, then: $OUIJIT_TASK_DESCRIPTION'`,
    );

  hook
    .command('list')
    .description('List all hooks')
    .action(async () => {
      const project = await requireProject();
      const hooks = await get(`/api/hooks${projectQuery(project)}`);
      printJson(hooks);
    });

  hook
    .command('get')
    .description('Get hook by type')
    .argument('<type>', `hook type (${VALID_HOOK_TYPES.join('|')})`)
    .action(async (type: string) => {
      const t = validateHookType(type);
      const project = await requireProject();
      const hooks = await get<Record<string, unknown>>(`/api/hooks${projectQuery(project)}`);
      printJson(hooks[t] || null);
    });

  hook
    .command('set')
    .description('Create or update a hook')
    .argument('<type>', `hook type (${VALID_HOOK_TYPES.join('|')})`)
    .requiredOption('--name <name>', 'hook name')
    .requiredOption('--command <cmd>', 'hook command')
    .option('--description <desc>', 'hook description')
    .option('--restart-if-running', 'run hook only: restart the command if it is already running in the task')
    .option(SANDBOX_FLAG, sandboxFlagHelp('start, continue, review, done: the sandbox the hook runs in'))
    .action(
      async (
        type: string,
        opts: { name: string; command: string; description?: string; restartIfRunning?: boolean; sandbox?: string },
      ) => {
        const t = validateHookType(type);
        // restartIfRunning only affects the run hook (the only hook surfaced as a
        // runner). Reject it elsewhere so it can't persist an inert, misleading flag.
        if (opts.restartIfRunning && t !== 'run') {
          return printError('--restart-if-running is only valid for the run hook');
        }
        const parsed = parseSandboxFlag(opts.sandbox);
        if ('error' in parsed) return printError(parsed.error);
        const { sandbox } = parsed;
        if (isActiveSandbox(sandbox) && !SANDBOXABLE_HOOK_TYPES.includes(t)) {
          return printError(`--sandbox is only valid for the ${SANDBOXABLE_HOOK_TYPES.join(', ')} hooks`);
        }
        const project = await requireProject();
        const result = await put(`/api/hooks/${t}${projectQuery(project)}`, {
          name: opts.name,
          command: opts.command,
          ...(opts.description && { description: opts.description }),
          ...(opts.restartIfRunning && { restartIfRunning: true }),
          ...(sandbox && { sandbox }),
        });
        printJson(result);
      },
    );

  hook
    .command('delete')
    .description('Delete a hook')
    .argument('<type>', `hook type (${VALID_HOOK_TYPES.join('|')})`)
    .action(async (type: string) => {
      const t = validateHookType(type);
      const project = await requireProject();
      const result = await del(`/api/hooks/${t}${projectQuery(project)}`);
      printJson(result);
    });

  const chatStart = hook
    .command('chat-start')
    .description('What stands in for the start hook where tasks open as chats: a setup command and a first message');

  chatStart
    .command('get')
    .description("Show the project's task chat setup and first message")
    .action(async () => {
      printJson(await get(`/api/chat-start${projectQuery(await requireProject())}`));
    });

  chatStart
    .command('set')
    .description('Set the setup command, the first message, or both; what is left out stays as it was')
    .option('--setup <cmd>', 'shell command run before a new task chat starts; "" for none')
    .option(
      '--first-message <text>',
      'sent to the task chat once setup succeeds, with $OUIJIT_ variables filled in; - reads stdin, "" sends nothing',
    )
    .action(async (opts: { setup?: string; firstMessage?: string }) => {
      if (opts.setup === undefined && opts.firstMessage === undefined) {
        return printError('Give --setup, --first-message, or both');
      }
      const firstMessage = opts.firstMessage === undefined ? undefined : await readBody(opts.firstMessage);
      printJson(
        await put(`/api/chat-start${projectQuery(await requireProject())}`, {
          ...(opts.setup !== undefined && { setup: opts.setup }),
          ...(firstMessage !== undefined && { firstMessage }),
        }),
      );
    });
}
