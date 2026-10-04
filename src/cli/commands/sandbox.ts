/**
 * CLI sandbox-command commands — the custom sandbox backend's launcher.
 */

import type { Command } from 'commander';
import { get, put, del, projectQuery } from '../api';
import { printJson } from '../output';

export function registerSandboxCommands(parent: Command, requireProject: () => string) {
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
