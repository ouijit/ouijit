/**
 * CLI hook commands — CRUD for script hooks via REST API.
 */

import type { Command } from 'commander';
import { get, put, del, projectQuery } from '../api';
import { printJson, printError } from '../output';

const VALID_HOOK_TYPES = ['start', 'continue', 'run', 'review', 'cleanup', 'editor'];

function validateHookType(type: string): string {
  if (!VALID_HOOK_TYPES.includes(type)) {
    return printError(`Invalid hook type: ${type}. Must be one of: ${VALID_HOOK_TYPES.join(', ')}`);
  }
  return type;
}

export function registerHookCommands(parent: Command, requireProject: () => string) {
  const hook = parent
    .command('hook')
    .description('Manage script hooks')
    .addHelpText(
      'after',
      `
Hook types: start, continue, run, review, cleanup, editor

Examples:
  ouijit hook list
  ouijit hook set start --name "Install deps" --command "npm install"
  ouijit hook get review
  ouijit hook delete cleanup`,
    );

  hook
    .command('list')
    .description('List all hooks')
    .action(async () => {
      const project = requireProject();
      const hooks = await get(`/api/hooks${projectQuery(project)}`);
      printJson(hooks);
    });

  hook
    .command('get')
    .description('Get hook by type')
    .argument('<type>', `hook type (${VALID_HOOK_TYPES.join('|')})`)
    .action(async (type: string) => {
      const t = validateHookType(type);
      const project = requireProject();
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
    .action(async (type: string, opts: { name: string; command: string; description?: string }) => {
      const t = validateHookType(type);
      const project = requireProject();
      const result = await put(`/api/hooks/${t}${projectQuery(project)}`, {
        name: opts.name,
        command: opts.command,
        ...(opts.description && { description: opts.description }),
      });
      printJson(result);
    });

  hook
    .command('delete')
    .description('Delete a hook')
    .argument('<type>', `hook type (${VALID_HOOK_TYPES.join('|')})`)
    .action(async (type: string) => {
      const t = validateHookType(type);
      const project = requireProject();
      const result = await del(`/api/hooks/${t}${projectQuery(project)}`);
      printJson(result);
    });
}
