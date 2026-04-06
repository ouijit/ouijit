/**
 * CLI hook commands — CRUD for script hooks.
 */

import { getHooks, getHook, saveHook, deleteHook } from '../../db';
import type { HookType } from '../../db/repos/hookRepo';
import { printJson, printError } from '../output';
import { notify } from '../notify';
import { generateId } from '../../utils/ids';

const VALID_HOOK_TYPES: HookType[] = ['start', 'continue', 'run', 'review', 'cleanup', 'editor'];

export async function handleHookCommand(
  action: string | undefined,
  rest: string[],
  flags: Record<string, string>,
  requireProject: () => string,
): Promise<void> {
  switch (action) {
    case 'list': {
      const project = requireProject();
      const hooks = await getHooks(project);
      printJson(hooks);
      break;
    }

    case 'get': {
      const project = requireProject();
      const type = rest[0] as HookType;
      if (!VALID_HOOK_TYPES.includes(type)) {
        printError(`Usage: ouijit hook get <${VALID_HOOK_TYPES.join('|')}>`);
      }
      const hook = await getHook(project, type);
      printJson(hook || null);
      break;
    }

    case 'set': {
      const project = requireProject();
      const type = rest[0] as HookType;
      if (!VALID_HOOK_TYPES.includes(type)) {
        printError(`Usage: ouijit hook set <${VALID_HOOK_TYPES.join('|')}> --name <name> --command <cmd>`);
      }
      if (!flags.name || !flags.command) {
        printError('Usage: ouijit hook set <type> --name <name> --command <cmd> [--description <desc>]');
      }
      const result = await saveHook(project, {
        id: generateId('hook'),
        type,
        name: flags.name,
        command: flags.command,
        ...(flags.description && { description: flags.description }),
      });
      notify(project, 'hook:set', `Hook saved: ${flags.name}`);
      printJson(result);
      break;
    }

    case 'delete': {
      const project = requireProject();
      const type = rest[0] as HookType;
      if (!VALID_HOOK_TYPES.includes(type)) {
        printError(`Usage: ouijit hook delete <${VALID_HOOK_TYPES.join('|')}>`);
      }
      const result = await deleteHook(project, type);
      notify(project, 'hook:delete', `${type} hook deleted`);
      printJson(result);
      break;
    }

    case 'help':
      process.stderr.write(`ouijit hook — manage script hooks

Actions:
  list                                                  List all hooks
  get <type>                                            Get hook by type
  set <type> --name <name> --command <cmd> [--description <d>]  Create/update hook
  delete <type>                                         Delete hook

Hook types: start, continue, run, review, cleanup, editor

Examples:
  ouijit hook list
  ouijit hook set start --name "Install deps" --command "npm install"
  ouijit hook delete review
`);
      process.exit(0);
      break;

    default:
      printError('Usage: ouijit hook <list|get|set|delete>\nRun "ouijit hook --help" for details.');
  }
}
