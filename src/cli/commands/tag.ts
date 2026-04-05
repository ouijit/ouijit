/**
 * CLI tag commands — CRUD for task tags.
 */

import { getAllTags, getTaskTags, addTagToTask, removeTagFromTask, setTaskTags } from '../../db';
import { printJson, printError } from '../output';
import { notify } from '../notify';

export async function handleTagCommand(
  action: string | undefined,
  rest: string[],
  flags: Record<string, string>,
  requireProject: () => string,
): Promise<void> {
  switch (action) {
    case 'list': {
      if (flags.task) {
        const project = requireProject();
        const taskNumber = parseInt(flags.task, 10);
        if (isNaN(taskNumber)) printError('--task must be a number');
        const tags = await getTaskTags(project, taskNumber);
        printJson(tags);
      } else {
        const tags = await getAllTags();
        printJson(tags);
      }
      break;
    }

    case 'add': {
      const project = requireProject();
      const taskNumber = parseInt(rest[0], 10);
      const tagName = rest[1];
      if (isNaN(taskNumber) || !tagName) printError('Usage: ouijit tag add <task-number> <tag-name>');
      const tag = await addTagToTask(project, taskNumber, tagName);
      notify(project, 'tag:add');
      printJson(tag);
      break;
    }

    case 'remove': {
      const project = requireProject();
      const taskNumber = parseInt(rest[0], 10);
      const tagName = rest[1];
      if (isNaN(taskNumber) || !tagName) printError('Usage: ouijit tag remove <task-number> <tag-name>');
      await removeTagFromTask(project, taskNumber, tagName);
      notify(project, 'tag:remove');
      printJson({ success: true });
      break;
    }

    case 'set': {
      const project = requireProject();
      const taskNumber = parseInt(rest[0], 10);
      const tagNames = rest.slice(1).filter((s) => !s.startsWith('--'));
      if (isNaN(taskNumber) || tagNames.length === 0) {
        printError('Usage: ouijit tag set <task-number> <tag1> [tag2...]');
      }
      const tags = await setTaskTags(project, taskNumber, tagNames);
      notify(project, 'tag:set');
      printJson(tags);
      break;
    }

    default:
      printError('Usage: ouijit tag <list|add|remove|set>');
  }
}
