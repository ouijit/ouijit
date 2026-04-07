/**
 * CLI project commands via REST API.
 */

import type { Command } from 'commander';
import { get } from '../api';
import { printJson } from '../output';

export function registerProjectCommands(parent: Command) {
  const project = parent.command('project').description('Manage projects');

  project
    .command('list')
    .description('List all registered projects')
    .action(async () => {
      const projects = await get('/api/projects');
      printJson(projects);
    });
}
