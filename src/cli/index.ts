/**
 * Ouijit CLI — manage tasks, hooks, tags, and projects from the command line.
 *
 * Communicates with the running Electron app via its REST API.
 * All commands output JSON to stdout. Errors go to stderr with non-zero exit.
 */

import { Command } from 'commander';
import { ApiError } from './api';
import { detectProject } from './detect';
import { printError } from './output';
import { registerTaskCommands } from './commands/task';
import { registerHookCommands } from './commands/hook';
import { registerTagCommands } from './commands/tag';
import { registerProjectCommands } from './commands/project';
import { registerScriptCommands } from './commands/script';
import { registerMarkdownCommands } from './commands/markdown';
import { registerPreviewCommands } from './commands/preview';
import { registerThemeCommands } from './commands/theme';

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
registerMarkdownCommands(program);
registerPreviewCommands(program);
registerThemeCommands(program);

// Command actions are async; parse() would let an API rejection surface as an
// uncaught error with a raw stack trace. parseAsync + a single catch turns any
// failure into a clean stderr message and a non-zero exit.
program.parseAsync().catch((err: unknown) => {
  if (err instanceof ApiError) {
    if (err.status === 403) {
      return printError(
        'Forbidden: this command is not available for the current session. ' +
          'Sandboxed sessions are read-only and limited to their own task.',
      );
    }
    return printError(err.status > 0 ? `${err.message} (HTTP ${err.status})` : err.message);
  }
  return printError(err instanceof Error ? err.message : String(err));
});
