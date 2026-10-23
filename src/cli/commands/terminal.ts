/**
 * CLI terminal commands via REST API.
 */

import type { Command } from 'commander';
import { get } from '../api';
import { printJson } from '../output';

export function registerTerminalCommands(parent: Command) {
  const terminal = parent.command('terminal').description('Inspect open terminals');

  terminal
    .command('list')
    .description("List open terminals in every project, with each one's task, sandbox and agent status")
    .action(async () => {
      printJson(await get('/api/terminals'));
    });
}
