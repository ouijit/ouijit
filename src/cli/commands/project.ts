/**
 * CLI project commands.
 */

import type { Command } from 'commander';
import { getAllProjects } from '../../db';
import { printJson } from '../output';

export function registerProjectCommands(parent: Command) {
  const project = parent.command('project').description('Manage projects');

  project
    .command('list')
    .description('List all registered projects')
    .action(async () => {
      const projects = await getAllProjects();
      printJson(projects);
    });
}
