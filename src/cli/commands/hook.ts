/**
 * CLI hook commands — CRUD for script hooks.
 */

import type { Command } from 'commander';
import { getHooks, getHook, saveHook, deleteHook } from '../../db';
import type { HookType } from '../../db/repos/hookRepo';
import { printJson, printError } from '../output';
import { notify } from '../notify';
import { generateId } from '../../utils/ids';

const VALID_HOOK_TYPES: HookType[] = ['start', 'continue', 'run', 'review', 'cleanup', 'editor'];

function validateHookType(type: string): HookType {
  if (!VALID_HOOK_TYPES.includes(type as HookType)) {
    return printError(`Invalid hook type: ${type}. Must be one of: ${VALID_HOOK_TYPES.join(', ')}`);
  }
  return type as HookType;
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
      const hooks = await getHooks(project);
      printJson(hooks);
    });

  hook
    .command('get')
    .description('Get hook by type')
    .argument('<type>', `hook type (${VALID_HOOK_TYPES.join('|')})`)
    .action(async (type: string) => {
      const project = requireProject();
      const t = validateHookType(type);
      const h = await getHook(project, t);
      printJson(h || null);
    });

  hook
    .command('set')
    .description('Create or update a hook')
    .argument('<type>', `hook type (${VALID_HOOK_TYPES.join('|')})`)
    .requiredOption('--name <name>', 'hook name')
    .requiredOption('--command <cmd>', 'hook command')
    .option('--description <desc>', 'hook description')
    .action(async (type: string, opts: { name: string; command: string; description?: string }) => {
      const project = requireProject();
      const t = validateHookType(type);
      const result = await saveHook(project, {
        id: generateId('hook'),
        type: t,
        name: opts.name,
        command: opts.command,
        ...(opts.description && { description: opts.description }),
      });
      notify(project, 'hook:set', `Hook saved: ${opts.name}`);
      printJson(result);
    });

  hook
    .command('delete')
    .description('Delete a hook')
    .argument('<type>', `hook type (${VALID_HOOK_TYPES.join('|')})`)
    .action(async (type: string) => {
      const project = requireProject();
      const t = validateHookType(type);
      const result = await deleteHook(project, t);
      notify(project, 'hook:delete', `${t} hook deleted`);
      printJson(result);
    });
}
