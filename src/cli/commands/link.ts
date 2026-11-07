/**
 * `ouijit link`: prints an `ouijit://` link for an agent to put in its reply.
 * Clicking it in a terminal takes the user there. Built here from what the CLI
 * already knows, so it works at any sandbox access level.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Command } from 'commander';
import { get } from '../api';
import { printJson, printError } from '../output';
import { buildLink, type DiffSpot, type LinkTarget } from '../../links/ouijitLink';

function int(value: string, label: string): number {
  const n = parseInt(value, 10);
  if (isNaN(n)) return printError(`${label} must be an integer`);
  return n;
}

function thisTerminal(): string {
  const ptyId = process.env['OUIJIT_PTY_ID'];
  if (!ptyId) return printError('OUIJIT_PTY_ID not set — run from an Ouijit terminal, or name the terminal');
  return ptyId;
}

function real(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/** The worktree this shell is in: the diff names files by their path in it. */
function worktreeRoot(): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/** `src/auth.ts:88`, relative to this shell, as the diff names it. */
function diffSpot(spec: string): DiffSpot {
  const match = /^(.*):(\d+)$/.exec(spec);
  const file = path.resolve(match ? match[1] : spec);
  const root = worktreeRoot();
  const relative = root ? path.relative(real(root), real(file)) : '';
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return printError(`${spec} is not in this worktree`);
  }
  return { path: relative.split(path.sep).join('/'), ...(match && { line: parseInt(match[2], 10) }) };
}

/** This terminal's task, when it has one: a link through the task outlives the terminal. */
async function ownTask(): Promise<number | null> {
  try {
    const task = await get<{ taskNumber?: number } | null>('/api/tasks/current');
    return task?.taskNumber ?? null;
  } catch {
    return null;
  }
}

export function registerLinkCommands(parent: Command, requireProject: () => string) {
  const project = () => path.basename(requireProject());
  const print = (target: LinkTarget) => printJson({ url: buildLink(target) });

  const link = parent
    .command('link')
    .description('Print an ouijit:// link that takes the user somewhere in Ouijit when clicked')
    .addHelpText(
      'after',
      `
Examples:
  ouijit link diff src/auth/session.ts:88   # → {"url": "ouijit://horizon/tasks/14/diff/src/auth/session.ts:88"}
  ouijit link task 14
  ouijit link pr 212
  ouijit link issue ENG-231
  ouijit link panel panel_3

Put the url in your reply; the user clicks it in the terminal to go there.
A link only navigates: opening one never runs or changes anything.`,
    );

  link
    .command('task')
    .description('A task: its terminal, or its card if it was never started')
    .argument('<number>', 'task number')
    .action((n: string) => print({ kind: 'task', project: project(), taskNumber: int(n, 'Task number') }));

  link
    .command('diff')
    .description("A file in this terminal's diff, or one line of it")
    .argument('<file[:line]>', 'path, optionally with a line')
    .argument('[pty-id]', 'terminal session id (defaults to this terminal)')
    .action(async (spec: string, ptyId?: string) => {
      const diff = diffSpot(spec);
      const task = ptyId ? null : await ownTask();
      if (task != null) return print({ kind: 'task', project: project(), taskNumber: task, diff });
      print({ kind: 'terminal', project: project(), ptyId: ptyId ?? thisTerminal(), diff });
    });

  link
    .command('terminal')
    .description('A terminal')
    .argument('[pty-id]', 'terminal session id (defaults to this terminal)')
    .action((ptyId?: string) => print({ kind: 'terminal', project: project(), ptyId: ptyId ?? thisTerminal() }));

  link
    .command('panel')
    .description('A panel on a terminal, by id from `panel list`')
    .argument('<id>', 'panel id')
    .argument('[pty-id]', 'terminal session id (defaults to this terminal)')
    .action((panelId: string, ptyId?: string) =>
      print({ kind: 'terminal', project: project(), ptyId: ptyId ?? thisTerminal(), panelId }),
    );

  link
    .command('pr')
    .description('A pull request')
    .argument('<number>', 'pull request number')
    .action((n: string) => print({ kind: 'pr', project: project(), number: int(n, 'Pull request number') }));

  link
    .command('issue')
    .description('An issue: a GitHub issue number, or a Linear identifier')
    .argument('<id>', '231 or ENG-231')
    .action((id: string) => print({ kind: 'issue', project: project(), id }));

  link
    .command('board')
    .description("This project's board")
    .action(() => print({ kind: 'board', project: project() }));

  link
    .command('project')
    .description('This project')
    .action(() => print({ kind: 'project', project: project() }));
}
