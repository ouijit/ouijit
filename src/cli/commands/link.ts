/**
 * `ouijit link`: prints an `ouijit://` link for an agent to put in its reply.
 * Clicking it in a terminal takes the user there. It works at any sandbox
 * access level.
 */

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

interface Terminal {
  ptyId: string;
  projectPath: string;
  taskNumber: number | null;
  worktreePath: string | null;
}

/** The terminal a link points at: its project, not this shell's, names the link. */
function terminal(ptyId?: string): Promise<Terminal> {
  const id = ptyId ?? process.env['OUIJIT_PTY_ID'];
  if (!id) return printError('OUIJIT_PTY_ID not set — run from an Ouijit terminal, or name the terminal');
  return get<Terminal>(`/api/terminals/${encodeURIComponent(id)}`);
}

/** A path's real location, through any symlink, for as much of it as exists. */
function real(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    const parent = path.dirname(p);
    return parent === p ? p : path.join(real(parent), path.basename(p));
  }
}

function within(root: string, file: string): string | null {
  const relative = path.relative(real(root), real(file));
  return relative.startsWith('..') || path.isAbsolute(relative) ? null : relative;
}

/**
 * `src/auth.ts:88` as the terminal's diff names it. A relative path is taken
 * from this shell when it is inside the terminal's checkout, and from the
 * checkout's root when it is not.
 */
function diffSpot(spec: string, { worktreePath, projectPath }: Terminal): DiffSpot {
  const match = /^(.*):(\d+)$/.exec(spec);
  const root = worktreePath ?? projectPath;
  const base = within(root, process.cwd()) === null ? root : process.cwd();
  const relative = within(root, path.resolve(base, match ? match[1] : spec));
  if (!relative) return printError(`${spec} is not in ${root}`);
  return { path: relative.split(path.sep).join('/'), ...(match && { line: parseInt(match[2], 10) }) };
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
      const target = await terminal(ptyId);
      const diff = diffSpot(spec, target);
      const project = path.basename(target.projectPath);
      // A link through the task outlives the terminal.
      if (!ptyId && target.taskNumber != null) {
        return print({ kind: 'task', project, taskNumber: target.taskNumber, diff });
      }
      print({ kind: 'terminal', project, ptyId: target.ptyId, diff });
    });

  link
    .command('terminal')
    .description('A terminal')
    .argument('[pty-id]', 'terminal session id (defaults to this terminal)')
    .action(async (ptyId?: string) => {
      const target = await terminal(ptyId);
      print({ kind: 'terminal', project: path.basename(target.projectPath), ptyId: target.ptyId });
    });

  link
    .command('panel')
    .description('A panel on a terminal, by id from `panel list`')
    .argument('<id>', 'panel id')
    .argument('[pty-id]', 'terminal session id (defaults to this terminal)')
    .action(async (panelId: string, ptyId?: string) => {
      const target = await terminal(ptyId);
      print({ kind: 'terminal', project: path.basename(target.projectPath), ptyId: target.ptyId, panelId });
    });

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
