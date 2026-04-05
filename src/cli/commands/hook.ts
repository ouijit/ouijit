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
      notify(project, 'hook:set');
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
      notify(project, 'hook:delete');
      printJson(result);
      break;
    }

    default:
      printError('Usage: ouijit hook <list|get|set|delete>');
  }
}
