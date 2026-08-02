/**
 * CLI pull request commands — read the inbox, read one PR, and link one to a
 * task, via the REST API.
 *
 * These are deliberately a small set. `gh` is already the tool for acting on
 * GitHub from a terminal; what it can't do is tell you which of your Ouijit
 * tasks a pull request belongs to, so that is what lives here.
 */

import type { Command } from 'commander';
import { get, post } from '../api';
import { printJson } from '../output';

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
