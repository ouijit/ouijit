/**
 * CLI Linear commands — read this project's issues, read one, link one to a
 * task, and stage a comment for a person to send.
 *
 * A small set, for the same reason `pr` is: what an agent cannot work out on
 * its own is which Ouijit task an issue belongs to, and where to put a comment
 * so a person sees it before Linear does.
 *
 * There is no `linear state`. Moving an issue is a person pressing a control on
 * an issue they are looking at; the same command in a task terminal is an agent
 * moving a ticket a team is watching, which is what drafts exist to prevent.
 */

import type { Command } from 'commander';
import { get, post, del } from '../api';
import { printJson, readBody } from '../output';

export function registerLinearCommands(parent: Command, requireProject: () => string) {
  const linear = parent
    .command('linear')
    .description('Inspect Linear issues and link them to tasks')
    .addHelpText(
      'after',
      `
Examples:
  ouijit linear list
  ouijit linear view ENG-214
  ouijit linear link ENG-214 --task 7`,
    );

  linear
    .command('list')
    .description("This project's Linear issues, in the groups the panel shows")
    .action(async () => {
      const project = requireProject();
      printJson(await get(`/api/linear/issues?project=${encodeURIComponent(project)}`));
    });

  linear
    .command('view')
    .description('Show one issue with its comments and workflow states')
    .argument('<identifier>', 'issue identifier, e.g. ENG-214')
    .action(async (identifier: string) => {
      const project = requireProject();
      printJson(
        await get(`/api/linear/issues/${encodeURIComponent(identifier)}?project=${encodeURIComponent(project)}`),
      );
    });

  linear
    .command('link')
    .description('Link an issue to a task')
    .argument('<identifier>', 'issue identifier, e.g. ENG-214')
    .requiredOption('--task <number>', 'task number to link it to')
    .action(async (identifier: string, options: { task: string }) => {
      const project = requireProject();
      printJson(
        await post(`/api/linear/issues/${encodeURIComponent(identifier)}/link?project=${encodeURIComponent(project)}`, {
          taskNumber: parseInt(options.task, 10),
        }),
      );
    });

  const draft = linear
    .command('draft')
    .description('Write comments on an issue, without sending them')
    .addHelpText(
      'after',
      `
Examples:
  ouijit linear draft list ENG-214
  ouijit linear draft add ENG-214 --body "the retry loop drops the last error"
  claude -p "summarise the fix" | ouijit linear draft add ENG-214 --body - --origin claude`,
    );

  draft
    .command('list')
    .description('List the unsent comments on an issue')
    .argument('<identifier>', 'issue identifier')
    .action(async (identifier: string) => {
      const project = requireProject();
      printJson(
        await get(`/api/linear/issues/${encodeURIComponent(identifier)}/drafts?project=${encodeURIComponent(project)}`),
      );
    });

  draft
    .command('add')
    .description('Add an unsent comment')
    .argument('<identifier>', 'issue identifier')
    .requiredOption('--body <text>', 'comment text, or - to read stdin')
    .option('--origin <name>', 'who wrote it, shown beside the comment', 'cli')
    .action(async (identifier: string, options: { body: string; origin: string }) => {
      const project = requireProject();
      printJson(
        await post(
          `/api/linear/issues/${encodeURIComponent(identifier)}/drafts?project=${encodeURIComponent(project)}`,
          { body: await readBody(options.body), origin: options.origin },
        ),
      );
    });

  draft
    .command('discard')
    .description('Delete an unsent comment')
    .argument('<identifier>', 'issue identifier')
    .argument('<id>', 'draft id, from `linear draft list`')
    .action(async (identifier: string, id: string) => {
      const project = requireProject();
      printJson(
        await del(
          `/api/linear/issues/${encodeURIComponent(identifier)}/drafts/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}`,
        ),
      );
    });
}
