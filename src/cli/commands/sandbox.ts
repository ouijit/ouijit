/**
 * CLI sandbox commands: running one command in the sandbox, and the custom
 * sandbox backend's launcher.
 */

import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import type { Command } from 'commander';
import { get, post, put, del, projectQuery } from '../api';
import { printJson } from '../output';

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

export function registerSandboxCommands(parent: Command, requireProject: () => string) {
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

  const sandbox = parent
    .command('sandbox-command')
    .description("Manage the project's custom sandbox launcher")
    .addHelpText(
      'after',
      `
The launcher runs as: <command> -- <shell> [shell args]. It must be an absolute
path or a name on PATH, outside the repository.

Examples:
  ouijit sandbox-command get
  ouijit sandbox-command set "$HOME/.local/bin/ouijit-sandbox --strict"
  ouijit sandbox-command clear`,
    );

  sandbox
    .command('get')
    .description('Show the configured launcher')
    .action(async () => {
      const project = requireProject();
      printJson(await get(`/api/sandbox/command${projectQuery(project)}`));
    });

  sandbox
    .command('set')
    .description('Set the launcher command')
    .argument('<command>', 'launcher and its arguments, as one quoted string')
    .action(async (command: string) => {
      const project = requireProject();
      printJson(await put(`/api/sandbox/command${projectQuery(project)}`, { command }));
    });

  sandbox
    .command('clear')
    .description('Remove the launcher')
    .action(async () => {
      const project = requireProject();
      printJson(await del(`/api/sandbox/command${projectQuery(project)}`));
    });
}
