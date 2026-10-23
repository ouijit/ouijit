/**
 * CLI point commands via REST API. A pointer is a suggestion the user can
 * follow: it never moves what they are looking at.
 */

import * as path from 'node:path';
import type { Command } from 'commander';
import { post, del, projectQuery } from '../api';
import { printJson, printError } from '../output';

function pointAt(target: Record<string, unknown>, project?: string): Promise<unknown> {
  return post(`/api/point${project ? projectQuery(project) : ''}`, target);
}

function int(value: string, label: string): number {
  const n = parseInt(value, 10);
  if (isNaN(n)) return printError(`${label} must be an integer`);
  return n;
}

/** `src/auth.ts:88` → the file, absolute so it resolves against any worktree, and the line. */
function fileAndLine(spec: string): { path: string; line?: number } {
  const match = /^(.*):(\d+)$/.exec(spec);
  const file = match ? match[1] : spec;
  return { path: path.resolve(file), ...(match && { line: parseInt(match[2], 10) }) };
}

export function registerPointCommands(parent: Command, requireProject: () => string) {
  const point = parent
    .command('point')
    .description('Point the user at something, for them to follow when they choose')
    .addHelpText(
      'after',
      `
Examples:
  ouijit point task 14
  ouijit point terminal pty_abc123
  ouijit point pr 212
  ouijit point issue ENG-231
  ouijit point diff src/auth/session.ts:88
  ouijit point note 7f3c
  ouijit point clear

Each terminal has one pointer; a new one replaces it.`,
    );

  point
    .command('task')
    .description('A task: its terminal when one is open, else its card')
    .argument('<number>', 'task number')
    .action(async (n: string) => {
      printJson(await pointAt({ kind: 'task', taskNumber: int(n, 'Task number') }, requireProject()));
    });

  point
    .command('terminal')
    .description('A terminal')
    .argument('<pty-id>', 'terminal session id')
    .action(async (ptyId: string) => {
      printJson(await pointAt({ kind: 'terminal', ptyId }));
    });

  point
    .command('project')
    .description('This project')
    .action(async () => {
      printJson(await pointAt({ kind: 'project' }, requireProject()));
    });

  point
    .command('board')
    .description("This project's board")
    .action(async () => {
      printJson(await pointAt({ kind: 'board' }, requireProject()));
    });

  point
    .command('pr')
    .description('A pull request')
    .argument('<number>', 'pull request number')
    .action(async (n: string) => {
      printJson(await pointAt({ kind: 'pr', number: int(n, 'Pull request number') }, requireProject()));
    });

  point
    .command('issue')
    .description('An issue: a GitHub issue number, or a Linear identifier')
    .argument('<id>', '231 or ENG-231')
    .action(async (id: string) => {
      printJson(await pointAt({ kind: 'issue', id }, requireProject()));
    });

  point
    .command('panel')
    .description('A panel on a terminal, by id from `panel list`')
    .argument('<id>', 'panel id')
    .argument('[pty-id]', 'terminal session id (defaults to this terminal)')
    .action(async (panelId: string, ptyId?: string) => {
      printJson(await pointAt({ kind: 'panel', panelId, ...(ptyId && { ptyId }) }));
    });

  point
    .command('diff')
    .description("A file in a terminal's diff, or one line of it")
    .argument('<file[:line]>', 'path, optionally with a line')
    .argument('[pty-id]', 'terminal session id (defaults to this terminal)')
    .action(async (spec: string, ptyId?: string) => {
      printJson(await pointAt({ kind: 'diff', ...fileAndLine(spec), ...(ptyId && { ptyId }) }));
    });

  point
    .command('note')
    .description("A note on this terminal's diff, by id from `diff notes`")
    .argument('<id>', 'note id')
    .action(async (noteId: string) => {
      printJson(await pointAt({ kind: 'note', noteId }));
    });

  point
    .command('clear')
    .description("Take back this terminal's pointer")
    .action(async () => {
      printJson(await del('/api/point'));
    });
}
