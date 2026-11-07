import type { Command } from 'commander';
import { post } from '../api';
import { printJson } from '../output';

export function registerIssueCommands(parent: Command, requireProject: () => string) {
  const issue = parent.command('issue').description('Link issues to tasks');

  issue
    .command('link')
    .description('Link a GitHub or Linear issue to a task')
    .argument('<issue>', 'a GitHub issue number, or a Linear identifier like ENG-214')
    .requiredOption('--task <number>', 'task number to link it to')
    .action(async (ref: string, options: { task: string }) => {
      const project = requireProject();
      const route = /^\d+$/.test(ref) ? 'issues' : 'linear/issues';
      printJson(
        await post(`/api/${route}/${encodeURIComponent(ref)}/link?project=${encodeURIComponent(project)}`, {
          taskNumber: parseInt(options.task, 10),
        }),
      );
    });
}
