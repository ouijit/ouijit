/**
 * Ouijit CLI — manage tasks, hooks, tags, and projects from the command line.
 *
 * Communicates with the running Electron app via its REST API.
 * All commands output JSON to stdout. Errors go to stderr with non-zero exit.
 */

import { Command } from 'commander';
import { detectProject } from './detect';
import { printError } from './output';
import { registerTaskCommands } from './commands/task';
import { registerHookCommands } from './commands/hook';
import { registerTagCommands } from './commands/tag';
import { registerProjectCommands } from './commands/project';
import { registerScriptCommands } from './commands/script';
import { registerPlanCommands } from './commands/plan';

const program = new Command();

program
  .name('ouijit')
  .description('Manage tasks, hooks, tags, and projects from the command line.\nAll commands output JSON to stdout.')
  .option('--project <path>', 'override project path detection')
  .addHelpText(
    'after',
    `
Examples:
  ouijit task create "Fix login bug"
  ouijit task list
  ouijit task set-status 5 in_review
  ouijit hook set start --name "Install" --command "npm install"
  ouijit tag add 5 bug`,
  );

function requireProject(): string {
  const opts = program.opts();
  const project = detectProject(opts.project);
  if (!project) return printError('Could not detect project. Use --project <path> or run from within a git repo.');
  return project;
}

registerTaskCommands(program, requireProject);
registerHookCommands(program, requireProject);
registerTagCommands(program, requireProject);
registerProjectCommands(program);
registerScriptCommands(program, requireProject);
registerPlanCommands(program);

program.parse();
