/**
 * CLI project commands.
 */

import { getAllProjects } from '../../db';
import { printJson, printError } from '../output';

export async function handleProjectCommand(action: string | undefined): Promise<void> {
  switch (action) {
    case 'list': {
      const projects = await getAllProjects();
      printJson(projects);
      break;
    }

    default:
      printError('Usage: ouijit project <list>');
  }
}
