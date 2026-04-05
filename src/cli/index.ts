/**
 * Ouijit CLI — manage tasks, hooks, tags, and projects from the command line.
 *
 * Shares the same business logic and SQLite database as the Electron app.
 * All commands output JSON to stdout. Errors go to stderr with non-zero exit.
 */

import { setUserDataPath, getDbPath, getUserDataPath } from '../paths';
import { initDatabase } from '../db/database';
import { detectProject } from './detect';
import { printError } from './output';
import { handleTaskCommand } from './commands/task';
import { handleHookCommand } from './commands/hook';
import { handleTagCommand } from './commands/tag';
import { handleProjectCommand } from './commands/project';

function printUsage(): never {
  process.stderr.write(`Usage: ouijit <resource> <action> [args] [flags]

Resources:
  task       Manage tasks (list, get, create, start, set-status, delete, ...)
  hook       Manage hooks (list, get, set, delete)
  tag        Manage tags (list, add, remove, set)
  project    Manage projects (list)

Global flags:
  --project <path>   Override project path detection
  --dev              Use dev database
  --help             Show this help

All commands output JSON to stdout.
`);
  process.exit(1);
}

// ── Parse global flags ──────────────────────────────────────────────

const args = process.argv.slice(2);
let explicitProject: string | undefined;
let devMode = false;

// Extract global flags before dispatching
const positional: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--project' && i + 1 < args.length) {
    explicitProject = args[++i];
  } else if (args[i] === '--dev') {
    devMode = true;
  } else if (args[i] === '--help' || args[i] === '-h') {
    printUsage();
  } else {
    positional.push(args[i]);
  }
}

const resource = positional[0];
const action = positional[1];
const rest = positional.slice(2);

if (!resource) printUsage();

// ── Initialize ──────────────────────────────────────────────────────

if (devMode) {
  setUserDataPath(getUserDataPath() + '-dev');
}

initDatabase(getDbPath());

// ── Detect project (for commands that need it) ──────────────────────

function requireProject(): string {
  const project = detectProject(explicitProject);
  if (!project) printError('Could not detect project. Use --project <path> or run from within a git repo.');
  return project;
}

// ── Dispatch ────────────────────────────────────────────────────────

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--') && i + 1 < args.length) {
      flags[args[i].slice(2)] = args[++i];
    }
  }
  return flags;
}

switch (resource) {
  case 'task':
    handleTaskCommand(action, rest, parseFlags(rest), requireProject);
    break;
  case 'hook':
    handleHookCommand(action, rest, parseFlags(rest), requireProject);
    break;
  case 'tag':
    handleTagCommand(action, rest, parseFlags(rest), requireProject);
    break;
  case 'project':
    handleProjectCommand(action);
    break;
  default:
    printError(`Unknown resource: ${resource}`);
}
