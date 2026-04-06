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

    case 'help':
      process.stderr.write(`ouijit project — manage projects

Actions:
  list    List all registered projects

Examples:
  ouijit project list
`);
      process.exit(0);
      break;

    default:
      printError('Usage: ouijit project <list>\nRun "ouijit project --help" for details.');
  }
}
