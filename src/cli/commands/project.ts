/**
 * CLI project commands via REST API.
 */

import type { Command } from 'commander';
import * as path from 'node:path';
import { get, post } from '../api';
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

  project
    .command('create')
    .description('Create a new project in your projects folder: a folder with a git repo, added to Ouijit')
    .argument('<name>', 'the project folder name')
    .action(async (name: string) => {
      printJson(await post('/api/projects', { name }));
    });

  project
    .command('add')
    .description('Add an existing git repo to Ouijit as a project')
    .argument('<path>', 'the project folder')
    .action(async (folder: string) => {
      printJson(await post('/api/projects/add', { path: path.resolve(folder) }));
    });
}
