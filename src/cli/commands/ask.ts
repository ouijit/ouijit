/**
 * CLI ask commands via REST API. An ask puts a command in front of the user,
 * who runs it on this computer or declines: the way out of a sandbox for one
 * command at a time.
 */

import type { Command } from 'commander';
import { post } from '../api';
import { printJson } from '../output';

interface AskOptions {
  message?: string;
  wait?: boolean;
}

function ask(body: Record<string, unknown>, opts: AskOptions): Promise<unknown> {
  return post('/api/ask/run', { ...body, ...(opts.message && { message: opts.message }), wait: !!opts.wait });
}

export function registerAskCommands(parent: Command) {
  const command = parent
    .command('ask')
    .description('Ask the user to run something on this computer, outside any sandbox')
    .addHelpText(
      'after',
      `
Examples:
  ouijit ask run -m "Needs the keychain" -- npm run release:sign
  ouijit ask run --wait -- ./scripts/migrate.sh --dry-run
  ouijit ask script "Dev server"

The ask shows as this terminal's pointer. Nothing runs until the user opens it,
reads the command and presses Run; it then runs in a runner panel on this
terminal. Without --wait the reply is {status: "pending"}; read the runner with
\`ouijit panel read\`. With --wait it comes once the user declines or the run
ends: {status: "declined"} or {status: "exited", exitCode, output, panelId}.`,
    );

  command
    .command('run')
    .description('Ask to run a command, given after --')
    .argument('<command...>', 'the command and its arguments')
    .option('-m, --message <text>', 'why, in a line')
    .option('--wait', 'answer once the user declines or the run ends')
    .allowUnknownOption()
    .action(async (argv: string[], opts: AskOptions) => {
      printJson(await ask({ argv }, opts));
    });

  command
    .command('script')
    .description('Ask to run a project script')
    .argument('<script>', 'script id or name, from `script list`')
    .option('-m, --message <text>', 'why, in a line')
    .option('--wait', 'answer once the user declines or the run ends')
    .action(async (script: string, opts: AskOptions) => {
      printJson(await ask({ script }, opts));
    });
}
