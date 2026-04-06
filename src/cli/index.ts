/**
 * Ouijit CLI — manage tasks, hooks, tags, and projects from the command line.
 *
 * Shares the same business logic and SQLite database as the Electron app.
 * All commands output JSON to stdout. Errors go to stderr with non-zero exit.
 */

import { Command, Option } from 'commander';
import { setUserDataPath, getDbPath, getUserDataPath } from '../paths';
import { initDatabase } from '../db/database';
import { detectProject } from './detect';
import { printError } from './output';
import { registerTaskCommands } from './commands/task';
import { registerHookCommands } from './commands/hook';
import { registerTagCommands } from './commands/tag';
import { registerProjectCommands } from './commands/project';
import { registerScriptCommands } from './commands/script';

const program = new Command();

program
  .name('ouijit')
  .description('Manage tasks, hooks, tags, and projects from the command line.\nAll commands output JSON to stdout.')
  .option('--project <path>', 'override project path detection')
  .addOption(new Option('--dev').default(false).hideHelp())
  .addHelpText(
    'after',
    `
Examples:
  ouijit task create "Fix login bug"
  ouijit task list
  ouijit task set-status 5 in_review
  ouijit hook set start --name "Install" --command "npm install"
  ouijit tag add 5 bug`,
  )
  .hook('preAction', () => {
    const opts = program.opts();
    if (opts.dev) {
      setUserDataPath(getUserDataPath() + '-dev');
    }
    initDatabase(getDbPath());
  });

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

program.parse();
