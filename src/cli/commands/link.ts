/**
 * `ouijit link`: prints an `ouijit://` link for an agent to put in its reply.
 * Clicking it in a terminal takes the user there. It works at any sandbox
 * access level.
 */

import * as path from 'node:path';
import type { Command } from 'commander';
import { get } from '../api';
import { printJson, printError } from '../output';
import { resolveSessionId } from '../sessionId';
import { relativeWithin } from '../../utils/pathSafety';
import { buildLink, type DiffSpot, type LinkTarget } from '../../links/ouijitLink';

function int(value: string, label: string): number {
  const n = parseInt(value, 10);
  if (isNaN(n)) return printError(`${label} must be an integer`);
  return n;
}

interface Session {
  sessionId: string;
  projectPath: string;
  taskNumber: number | null;
  worktreePath: string | null;
}

async function session(sessionId?: string): Promise<Session & { project: string }> {
  const found = await get<Session>(`/api/terminals/${encodeURIComponent(resolveSessionId(sessionId))}`);
  return { ...found, project: path.basename(found.projectPath) };
}

/**
 * `src/auth.ts:88` as the terminal's diff names it. A relative path is taken
 * from this shell when it is inside the terminal's checkout, and from the
 * checkout's root when it is not.
 */
function diffSpot(
  spec: string,
  { worktreePath, projectPath }: Pick<Session, 'worktreePath' | 'projectPath'>,
): DiffSpot {
  const match = /^(.*):(\d+)$/.exec(spec);
  const root = worktreePath || projectPath;
  const shellInCheckout = relativeWithin(root, process.cwd()) !== null;
  const relative = relativeWithin(root, path.resolve(shellInCheckout ? process.cwd() : root, match ? match[1] : spec));
  if (!relative) return printError(`${spec} is not in ${root}`);
  return { path: relative.split(path.sep).join('/'), ...(match && { line: parseInt(match[2], 10) }) };
}

export function registerLinkCommands(parent: Command, requireProject: () => Promise<string>) {
  const project = async () => path.basename(await requireProject());
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
    .action(async (n: string) => print({ kind: 'task', project: await project(), taskNumber: int(n, 'Task number') }));

  link
    .command('diff')
    .description("A file in this terminal's diff, or one line of it")
    .argument('<file[:line]>', 'path, optionally with a line')
    .argument('[session-id]', 'session id (defaults to this one)')
    .action(async (spec: string, sessionId?: string) => {
      const { project, sessionId: id, taskNumber, ...where } = await session(sessionId);
      const diff = diffSpot(spec, where);
      // A link through the task outlives the session.
      if (!sessionId && taskNumber != null) return print({ kind: 'task', project, taskNumber, diff });
      print({ kind: 'terminal', project, ptyId: id, diff });
    });

  link
    .command('session')
    .description('A session: a terminal or a chat')
    .argument('[session-id]', 'session id (defaults to this one)')
    .action(async (sessionId?: string) => {
      const { project, sessionId: id } = await session(sessionId);
      print({ kind: 'terminal', project, ptyId: id });
    });

  link
    .command('panel')
    .description('A panel on a session, by id from `panel list`')
    .argument('<id>', 'panel id')
    .argument('[session-id]', 'session id (defaults to this one)')
    .action(async (panelId: string, sessionId?: string) => {
      const { project, sessionId: id } = await session(sessionId);
      print({ kind: 'terminal', project, ptyId: id, panelId });
    });

  link
    .command('pr')
    .description('A pull request')
    .argument('<number>', 'pull request number')
    .action(async (n: string) =>
      print({ kind: 'pr', project: await project(), number: int(n, 'Pull request number') }),
    );

  link
    .command('issue')
    .description('An issue: a GitHub issue number, or a Linear identifier')
    .argument('<id>', '231 or ENG-231')
    .action(async (id: string) => print({ kind: 'issue', project: await project(), id }));

  link
    .command('board')
    .description("This project's board")
    .action(async () => print({ kind: 'board', project: await project() }));

  link
    .command('project')
    .description('This project')
    .action(async () => print({ kind: 'project', project: await project() }));
}
