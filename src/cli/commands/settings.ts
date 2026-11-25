/**
 * CLI settings commands: what the Settings page sets for a project, and Chat's own settings.
 */

import * as path from 'node:path';
import type { Command } from 'commander';
import { get, post, put, del, projectQuery } from '../api';
import { printJson, printError, readBody } from '../output';
import { parseSandboxFlag } from '../sandboxFlag';
import { CHAT_AGENT_IDS, isChatAgentId } from '../../chat/model';

const AGENT_VALUES = CHAT_AGENT_IDS.join('|');
const PLACE_VALUES = 'host|nono|custom';

function agentFlag(value: string | undefined): string | undefined {
  if (value !== undefined && !isChatAgentId(value)) {
    return printError(`Invalid --agent: ${value}. Must be one of: ${AGENT_VALUES}`);
  }
  return value;
}

function placeFlag(flag: string, value: string | undefined): string | undefined {
  const parsed = parseSandboxFlag(value);
  if ('error' in parsed) return printError(`Invalid ${flag}: ${value}. Must be one of: ${PLACE_VALUES}`);
  return parsed.sandbox;
}

function defined(body: Record<string, unknown>): Record<string, unknown> {
  const given = Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));
  if (Object.keys(given).length === 0) return printError('Nothing to set: give at least one option');
  return given;
}

function parseWake(pairs: string[]): Record<string, boolean> | undefined {
  if (pairs.length === 0) return undefined;
  return Object.fromEntries(
    pairs.map((pair) => {
      const [event, state] = pair.split('=');
      if (!event || (state !== 'on' && state !== 'off')) {
        return printError(`Invalid --wake: ${pair}. Write it as <event>=on or <event>=off`);
      }
      return [event, state === 'on'];
    }),
  );
}

export function registerSettingsCommands(parent: Command, requireProject: () => Promise<string>) {
  const settings = parent
    .command('settings')
    .description("Read and change the Settings page: a project's tasks, worktrees, lenses and sandbox, and Chat")
    .addHelpText(
      'after',
      `
Examples:
  ouijit settings tasks set --open-in chat --agent codex --setup "npm install"
  ouijit settings worktree set --mode clean-checkout --branch-from origin/main
  ouijit settings lens add "Risk first" --instruction "Lead with what could break in production"
  ouijit settings sandbox set --default nono --cli-access task
  ouijit settings chat set --enable --agent claude --wake taskMoved=off`,
    );

  const project = async (route: string) => `${route}${projectQuery(await requireProject())}`;

  // ── Tasks ────────────────────────────────────────────────────────
  const tasks = settings.command('tasks').description("How the project's tasks open: in a terminal or as a chat");

  tasks
    .command('get')
    .description('Show where tasks open, the chat agent, and the chat setup and first message')
    .action(async () => printJson(await get(await project('/api/task-opening'))));

  tasks
    .command('set')
    .description('Change what is given; what is left out stays as it was')
    .option('--open-in <surface>', 'terminal, where the start hook runs, or chat (terminal|chat)')
    .option('--agent <agent>', `the agent a task chat runs (${AGENT_VALUES})`)
    .option('--setup <cmd>', 'shell command run before a new task chat starts; "" for none')
    .option(
      '--first-message <text>',
      'sent to the task chat once setup succeeds, with $OUIJIT_ variables filled in; - reads stdin, "" sends nothing',
    )
    .action(async (opts: { openIn?: string; agent?: string; setup?: string; firstMessage?: string }) => {
      if (opts.openIn !== undefined && opts.openIn !== 'terminal' && opts.openIn !== 'chat') {
        return printError(`Invalid --open-in: ${opts.openIn}. Must be terminal or chat`);
      }
      const body = defined({
        surface: opts.openIn,
        agent: agentFlag(opts.agent),
        setup: opts.setup,
        firstMessage: opts.firstMessage,
      });
      if (opts.firstMessage !== undefined) body.firstMessage = await readBody(opts.firstMessage);
      printJson(await put(await project('/api/task-opening'), body));
    });

  // ── Worktree ─────────────────────────────────────────────────────
  const worktree = settings.command('worktree').description("How the project's task worktrees are made");

  worktree
    .command('get')
    .description('Show the worktree mode and the branch new tasks branch from')
    .action(async () => printJson(await get(await project('/api/worktree-settings'))));

  worktree
    .command('set')
    .description('Change what is given; what is left out stays as it was')
    .option('--mode <mode>', 'quick-start copies ignored files like .env; clean-checkout copies nothing')
    .option(
      '--branch-from <branch>',
      'a branch, origin/main say, fetched first when remote; "" for the checked-out one',
    )
    .action(async (opts: { mode?: string; branchFrom?: string }) => {
      printJson(
        await put(await project('/api/worktree-settings'), defined({ mode: opts.mode, branchFrom: opts.branchFrom })),
      );
    });

  // ── Lenses ───────────────────────────────────────────────────────
  const lens = settings
    .command('lens')
    .description("The project's lenses, the groupings any diff can be read by (pr lens writes one PR's lens)");

  lens
    .command('list')
    .description("List the project's lenses")
    .action(async () => printJson(await get(await project('/api/project-lenses'))));

  lens
    .command('add')
    .description('Add a lens')
    .argument('<name>', 'the name it is picked by')
    .requiredOption('--instruction <text>', 'how the agent groups the diff; - reads stdin')
    .action(async (name: string, opts: { instruction: string }) => {
      printJson(
        await post(await project('/api/project-lenses'), { name, instruction: await readBody(opts.instruction) }),
      );
    });

  lens
    .command('edit')
    .description('Rename a lens or change its instruction')
    .argument('<lens>', 'its id or name')
    .option('--name <name>', 'its new name')
    .option('--instruction <text>', 'its new instruction; - reads stdin')
    .action(async (id: string, opts: { name?: string; instruction?: string }) => {
      const body = defined({ name: opts.name, instruction: opts.instruction });
      if (opts.instruction !== undefined) body.instruction = await readBody(opts.instruction);
      printJson(await put(await project(`/api/project-lenses/${encodeURIComponent(id)}`), body));
    });

  lens
    .command('remove')
    .description('Remove a lens')
    .argument('<lens>', 'its id or name')
    .action(async (id: string) => printJson(await del(await project(`/api/project-lenses/${encodeURIComponent(id)}`))));

  const lensAgent = lens.command('agent').description('The agent that writes lenses');

  lensAgent
    .command('get')
    .description('Show the chosen agent; null picks the first one installed')
    .action(async () => printJson(await get(await project('/api/lens-agent'))));

  lensAgent
    .command('set')
    .description('Choose the agent')
    .argument('<agent>', 'claude, codex or pi; auto for the first one installed')
    .action(async (agent: string) => {
      printJson(await put(await project('/api/lens-agent'), { agent: agent === 'auto' ? null : agent }));
    });

  // ── Sandbox ──────────────────────────────────────────────────────
  const sandbox = settings
    .command('sandbox')
    .description("Where the project's work runs and what its sandbox may do, from a host terminal");

  sandbox
    .command('get')
    .description('Show the default place, the sandbox profile and the Ouijit CLI access')
    .action(async () => printJson(await get(await project('/api/sandbox-settings'))));

  sandbox
    .command('set')
    .description('Change what is given; what is left out stays as it was')
    .option('--default <place>', `where tasks and hooks run unless they say (${PLACE_VALUES})`)
    .option('--profile <path>', 'a nono profile file used in place of the project\'s own; "" for its own')
    .option(
      '--cli-access <level>',
      'what a sandboxed terminal may do with ouijit: read (View), task (Own task) or all (Whole board)',
    )
    .action(async (opts: { default?: string; profile?: string; cliAccess?: string }) => {
      printJson(
        await put(
          await project('/api/sandbox-settings'),
          defined({
            default: placeFlag('--default', opts.default),
            profile: opts.profile && path.resolve(opts.profile),
            cliAccess: opts.cliAccess,
          }),
        ),
      );
    });

  // ── Chat ─────────────────────────────────────────────────────────
  const chat = settings.command('chat').description('Chat on or off, and the main chat (app-wide)');

  chat
    .command('get')
    .description("Show whether Chat is on, and the main chat's agent, place, instructions and wake events")
    .action(async () => printJson(await get('/api/chat-settings')));

  chat
    .command('set')
    .description(
      'Change what is given. A new agent, place or instructions restarts the main chat on the same conversation',
    )
    .option('--enable', 'turn Chat on')
    .option('--disable', 'turn Chat off')
    .option('--agent <agent>', `the main chat's agent (${AGENT_VALUES})`)
    .option('--run-in <place>', `where the main chat runs, from a host terminal (${PLACE_VALUES})`)
    .option('--instructions <text>', 'read at the start of every conversation; - reads stdin, "" for none')
    .option(
      '--wake <event=on|off>',
      'what arrives as a message unasked: turnEnded, asked, taskMoved, hookFailed; repeatable',
      (pair: string, pairs: string[]) => [...pairs, pair],
      [] as string[],
    )
    .action(
      async (opts: {
        enable?: boolean;
        disable?: boolean;
        agent?: string;
        runIn?: string;
        instructions?: string;
        wake: string[];
      }) => {
        if (opts.enable && opts.disable) return printError('Give --enable or --disable, not both');
        const body = defined({
          enabled: opts.enable ? true : opts.disable ? false : undefined,
          agent: agentFlag(opts.agent),
          sandbox: placeFlag('--run-in', opts.runIn),
          instructions: opts.instructions,
          wake: parseWake(opts.wake),
        });
        if (opts.instructions) body.instructions = await readBody(opts.instructions);
        printJson(await put('/api/chat-settings', body));
      },
    );
}
