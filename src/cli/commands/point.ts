/**
 * CLI point commands via REST API. A pointer is a suggestion the user can
 * follow: it never moves what they are looking at.
 */

import * as path from 'node:path';
import type { Command } from 'commander';
import { post, del, projectQuery } from '../api';
import { printJson, printError } from '../output';

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

interface TargetCommand {
  name: string;
  description: string;
  args: [spec: string, help: string][];
  /** Whether the target is named within the current project. */
  inProject?: boolean;
  target: (args: string[]) => Record<string, unknown>;
}

const PTY = ['[pty-id]', 'terminal session id (defaults to this terminal)'] as [string, string];

const TARGETS: TargetCommand[] = [
  {
    name: 'task',
    description: 'A task: following opens its terminal, or its card if it was never started',
    args: [['<number>', 'task number']],
    inProject: true,
    target: ([n]) => ({ kind: 'task', taskNumber: int(n, 'Task number') }),
  },
  {
    name: 'terminal',
    description: 'A terminal',
    args: [['<pty-id>', 'terminal session id']],
    target: ([ptyId]) => ({ kind: 'terminal', ptyId }),
  },
  { name: 'project', description: 'This project', args: [], inProject: true, target: () => ({ kind: 'project' }) },
  { name: 'board', description: "This project's board", args: [], inProject: true, target: () => ({ kind: 'board' }) },
  {
    name: 'pr',
    description: 'A pull request',
    args: [['<number>', 'pull request number']],
    inProject: true,
    target: ([n]) => ({ kind: 'pr', number: int(n, 'Pull request number') }),
  },
  {
    name: 'issue',
    description: 'An issue: a GitHub issue number, or a Linear identifier',
    args: [['<id>', '231 or ENG-231']],
    inProject: true,
    target: ([id]) => ({ kind: 'issue', id }),
  },
  {
    name: 'panel',
    description: 'A panel on a terminal, by id from `panel list`',
    args: [['<id>', 'panel id'], PTY],
    target: ([panelId, ptyId]) => ({ kind: 'panel', panelId, ...(ptyId && { ptyId }) }),
  },
  {
    name: 'diff',
    description: "A file in a terminal's diff, or one line of it",
    args: [['<file[:line]>', 'path, optionally with a line'], PTY],
    target: ([spec, ptyId]) => ({ kind: 'diff', ...fileAndLine(spec), ...(ptyId && { ptyId }) }),
  },
  {
    name: 'note',
    description: "A note on this terminal's diff, by id from `diff notes`",
    args: [['<id>', 'note id']],
    target: ([noteId]) => ({ kind: 'note', noteId }),
  },
];

export function registerPointCommands(parent: Command, requireProject: () => string) {
  const point = parent
    .command('point')
    .description('Point the user at something, for them to follow when they choose')
    .addHelpText(
      'after',
      `
Examples:
  ouijit point task 14 -m "Split out of auth; its tests aren't written yet"
  ouijit point terminal pty_abc123
  ouijit point pr 212 -m "Up for review, one breaking change"
  ouijit point issue ENG-231
  ouijit point diff src/auth/session.ts:88 -m "This races the refresh"
  ouijit point note 7f3c
  ouijit point clear

Each terminal has one pointer; a new one replaces it. -m labels it with
what it's about, shown where the user sees the pointer.`,
    );

  for (const spec of TARGETS) {
    const command = point.command(spec.name).description(spec.description);
    for (const [arg, help] of spec.args) command.argument(arg, help);
    command.option('-m, --message <text>', 'what it is about, in a line').action(async (...received: unknown[]) => {
      const args = received.slice(0, spec.args.length) as string[];
      const { message } = received[spec.args.length] as { message?: string };
      const query = spec.inProject ? projectQuery(requireProject()) : '';
      printJson(await post(`/api/point${query}`, { ...spec.target(args), ...(message && { message }) }));
    });
  }

  point
    .command('clear')
    .description("Take back this terminal's pointer")
    .action(async () => {
      printJson(await del('/api/point'));
    });
}
