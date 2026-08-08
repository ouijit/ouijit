/**
 * CLI pull request commands — read the inbox, read one PR, and link one to a
 * task, via the REST API.
 *
 * These are deliberately a small set. `gh` is already the tool for acting on
 * GitHub from a terminal; what it can't do is tell you which of your Ouijit
 * tasks a pull request belongs to, so that is what lives here.
 */

import type { Command } from 'commander';
import { get, post, put, del } from '../api';
import { printJson } from '../output';

/**
 * Read a draft body from `--body <text>`, or from stdin when it is `-`.
 *
 * The stdin path is the one that matters: anything generating review comments
 * produces multi-line prose, and pushing that through a shell argument is where
 * quoting goes wrong. `--body -` is how a reviewing agent writes back.
 */
async function readBody(value: string): Promise<string> {
  if (value !== '-') return value;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const body = Buffer.concat(chunks).toString('utf8').trim();
  if (!body) throw new Error('No body on stdin');
  return body;
}

export function registerPrCommands(parent: Command, requireProject: () => string) {
  const pr = parent
    .command('pr')
    .description('Inspect pull requests and link them to tasks')
    .addHelpText(
      'after',
      `
Examples:
  ouijit pr list
  ouijit pr view 42
  ouijit pr link 42 --task 7`,
    );

  pr.command('list')
    .description('List open pull requests, grouped into review / yours / others')
    .action(async () => {
      const project = requireProject();
      printJson(await get(`/api/pulls?project=${encodeURIComponent(project)}`));
    });

  pr.command('view')
    .description('Show one pull request with its threads, timeline, and checks')
    .argument('<number>', 'pull request number')
    .action(async (number: string) => {
      const project = requireProject();
      printJson(await get(`/api/pulls/${encodeURIComponent(number)}?project=${encodeURIComponent(project)}`));
    });

  // ── Review drafts ───────────────────────────────────────────────────
  // Comments staged locally against a pull request, held until a person sends
  // them as one review. Writing them from here is what lets a reviewing agent
  // hand you its findings without anything reaching GitHub under your name:
  // the send is still a press in the app.
  const draft = pr
    .command('draft')
    .description('Write review comments into the pending review, without sending them')
    .addHelpText(
      'after',
      `
Examples:
  ouijit pr draft list 42
  ouijit pr draft add 42 --file src/api.ts --line 88 --body "this can throw"
  claude -p "review the diff" | ouijit pr draft add 42 --file src/api.ts --line 88 --body - --origin claude`,
    );

  draft
    .command('list')
    .description('List the unsent review comments on a pull request')
    .argument('<number>', 'pull request number')
    .action(async (number: string) => {
      const project = requireProject();
      printJson(await get(`/api/pulls/${encodeURIComponent(number)}/drafts?project=${encodeURIComponent(project)}`));
    });

  draft
    .command('add')
    .description('Add an unsent review comment')
    .argument('<number>', 'pull request number')
    .requiredOption('--file <path>', 'file the comment is about, as it appears in the diff')
    .requiredOption('--line <number>', 'line within that file')
    .requiredOption('--body <text>', 'comment text, or - to read stdin')
    .option('--side <side>', 'RIGHT for the new version, LEFT for the old one', 'RIGHT')
    .option('--start-line <number>', 'first line, when the comment spans a range')
    .option('--origin <name>', 'who wrote it, shown beside the comment', 'cli')
    .action(
      async (
        number: string,
        options: { file: string; line: string; body: string; side: string; startLine?: string; origin: string },
      ) => {
        const project = requireProject();
        printJson(
          await post(`/api/pulls/${encodeURIComponent(number)}/drafts?project=${encodeURIComponent(project)}`, {
            path: options.file,
            line: parseInt(options.line, 10),
            side: options.side.toUpperCase() === 'LEFT' ? 'LEFT' : 'RIGHT',
            ...(options.startLine ? { startLine: parseInt(options.startLine, 10) } : {}),
            body: await readBody(options.body),
            origin: options.origin,
          }),
        );
      },
    );

  draft
    .command('discard')
    .description('Delete an unsent review comment')
    .argument('<number>', 'pull request number')
    .argument('<id>', 'draft id, from `pr draft list`')
    .action(async (number: string, id: string) => {
      const project = requireProject();
      printJson(
        await del(
          `/api/pulls/${encodeURIComponent(number)}/drafts/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}`,
        ),
      );
    });

  // ── Pull request commands ───────────────────────────────────────────
  // Named shell commands run with a pull request's context. A `lens` reads the
  // changed-file list on stdin and prints { "groups": [...] } to regroup the
  // diff into a reading order; a `terminal` command opens a session instead.
  // Ouijit supplies the context and the plumbing — what the command decides is
  // entirely yours.
  const prCommand = pr
    .command('command')
    .description('Manage named commands that run against a pull request')
    .addHelpText(
      'after',
      `
Environment given to both modes:
  OUIJIT_PR_NUMBER  OUIJIT_PR_BRANCH  OUIJIT_PR_URL  OUIJIT_PR_TITLE
  OUIJIT_WORKTREE_PATH (only when the pull request is checked out as a task)

A lens reads {"prNumber","title","baseRefName","headRefName","files":[{"path",…]}
on stdin and prints {"groups":[{"title","summary","paths":[…]}]} on stdout. Files
it leaves out are still shown, in a trailing group — a lens can reorder the diff
but never hide part of it.

Examples:
  ouijit pr command list
  ouijit pr command set --name narrative --command ./scripts/review-order.sh --mode lens
  ouijit pr command set --name claude --command 'claude "review this PR"' --mode terminal
  ouijit pr command delete narrative`,
    );

  prCommand
    .command('list')
    .description('List the pull request commands for this project')
    .action(async () => {
      const project = requireProject();
      printJson(await get(`/api/pr-commands?project=${encodeURIComponent(project)}`));
    });

  prCommand
    .command('set')
    .description('Create or update a pull request command')
    .requiredOption('--name <name>', 'name shown in the app')
    .requiredOption('--command <command>', 'shell command to run')
    .option('--mode <mode>', 'lens (regroups the diff) or terminal (opens a session)', 'lens')
    .action(async (options: { name: string; command: string; mode: string }) => {
      const project = requireProject();
      if (options.mode !== 'lens' && options.mode !== 'terminal') {
        throw new Error(`Invalid mode "${options.mode}". Must be lens or terminal.`);
      }
      printJson(
        await put(`/api/pr-commands?project=${encodeURIComponent(project)}`, {
          name: options.name,
          command: options.command,
          mode: options.mode,
        }),
      );
    });

  prCommand
    .command('delete')
    .description('Delete a pull request command')
    .argument('<name>', 'command name')
    .action(async (name: string) => {
      const project = requireProject();
      printJson(await del(`/api/pr-commands/${encodeURIComponent(name)}?project=${encodeURIComponent(project)}`));
    });

  pr.command('link')
    .description('Link a pull request to a task')
    .argument('<number>', 'pull request number')
    .requiredOption('--task <number>', 'task number to link it to')
    .action(async (number: string, options: { task: string }) => {
      const project = requireProject();
      const taskNumber = parseInt(options.task, 10);
      printJson(
        await post(`/api/pulls/${encodeURIComponent(number)}/link?project=${encodeURIComponent(project)}`, {
          taskNumber,
        }),
      );
    });
}
