/**
 * CLI sandbox command: running one command in the sandbox.
 */

import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import type { Command } from 'commander';
import { post } from '../api';

interface WrappedCommand {
  file: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  token: string;
}

async function runSandboxed(argv: string[], custom: boolean): Promise<never> {
  const wrapped = await post<WrappedCommand>('/api/sandbox/wrap', {
    argv,
    cwd: process.cwd(),
    backend: custom ? 'custom' : 'nono',
  });
  const child = spawn(wrapped.file, wrapped.args, {
    cwd: wrapped.cwd,
    env: { ...process.env, ...wrapped.env },
    stdio: 'inherit',
  });
  // The terminal sends Ctrl-C to the whole foreground group, child included;
  // this process waits to hand the token back rather than die first.
  for (const signal of ['SIGINT', 'SIGQUIT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, () => child.kill(signal));
  }
  const code = await new Promise<number>((resolve) => {
    child.on('error', (error) => {
      console.error(`ouijit sandbox: ${error.message}`);
      resolve(127);
    });
    child.on('exit', (exitCode, signal) => resolve(exitCode ?? 128 + (signal ? constants.signals[signal] : 1)));
  });
  await post<unknown>('/api/sandbox/release', { token: wrapped.token }).catch((): undefined => undefined);
  process.exit(code);
}

export function registerSandboxCommands(parent: Command) {
  parent
    .command('sandbox')
    .description("Run a command in the project's sandbox, from a host terminal")
    .option('--custom', 'use the Custom sandbox instead')
    .argument('<command...>', 'the command and its arguments, after --')
    .allowUnknownOption()
    .addHelpText(
      'after',
      `
The command gets the grants its terminal's task would, and Ouijit CLI access
at the project's sandbox level. Everything around it stays on the host.

Examples:
  ouijit sandbox -- claude --dangerously-skip-permissions
  git pull && ouijit sandbox -- codex --full-auto "$OUIJIT_TASK_NAME"`,
    )
    .action(async (argv: string[], opts: { custom?: boolean }) => {
      await runSandboxed(argv, opts.custom ?? false);
    });
}
