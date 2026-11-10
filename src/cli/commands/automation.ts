/**
 * CLI automation commands: a command or an agent prompt on a schedule.
 */

import type { Command } from 'commander';
import { get, post, del, projectQuery } from '../api';
import { printJson } from '../output';

interface CreateOptions {
  every?: string;
  cron?: string;
  prompt?: string;
  command?: string;
  script?: string;
  missed?: string;
  in?: string;
  sandbox?: string;
}

export function registerAutomationCommands(parent: Command, requireProject: () => string) {
  const automation = parent
    .command('automation')
    .description('Run a command or an agent on a schedule')
    .addHelpText(
      'after',
      `
Examples:
  ouijit automation create "PR triage" --every "weekdays 09:00" --prompt "Triage new PRs and stage review comments"
  ouijit automation create "Audit" --every "daily 02:00" --command "npm audit" --in project
  ouijit automation run "PR triage"
  ouijit automation notify "Two PRs need review; comments are staged"`,
    );

  automation
    .command('list')
    .description('List automations with their schedule and last run (JSON array)')
    .action(async () => {
      const project = requireProject();
      printJson(await get(`/api/automations${projectQuery(project)}`));
    });

  automation
    .command('create')
    .description('Create an automation')
    .argument('<name>', 'automation name')
    .option('--every <schedule>', 'hourly | daily HH:MM | weekdays HH:MM | weekly <day> HH:MM | manual')
    .option('--cron <expr>', 'a five-field cron expression, in local time')
    .option('--prompt <text>', 'run the project agent (its start hook) with this prompt')
    .option('--command <cmd>', 'run this shell command')
    .option('--script <name>', "run one of the project's scripts")
    .option('--missed <policy>', 'run-once (default) or skip, for runs missed while Ouijit was closed')
    .option('--in <where>', 'worktree (default) or project')
    .option('--sandbox <name>', 'host | nono | custom (default: the sandbox)')
    .action(async (name: string, opts: CreateOptions) => {
      const project = requireProject();
      const body: Record<string, unknown> = { name };
      for (const [key, value] of Object.entries(opts)) if (value !== undefined) body[key] = value;
      if (body.sandbox === 'host') body.sandbox = 'none';
      printJson(await post(`/api/automations${projectQuery(project)}`, body));
    });

  for (const [verb, description] of [
    ['run', 'Run an automation now'],
    ['pause', 'Stop an automation running on its schedule'],
    ['resume', 'Put a paused automation back on its schedule'],
  ] as const) {
    automation
      .command(verb)
      .description(description)
      .argument('<name>', 'automation name or id')
      .action(async (name: string) => {
        const project = requireProject();
        printJson(await post(`/api/automations/${encodeURIComponent(name)}/${verb}${projectQuery(project)}`));
      });
  }

  automation
    .command('delete')
    .description('Delete an automation')
    .argument('<name>', 'automation name or id')
    .action(async (name: string) => {
      const project = requireProject();
      printJson(await del(`/api/automations/${encodeURIComponent(name)}${projectQuery(project)}`));
    });

  automation
    .command('notify')
    .description('From inside a run: tell the user this run needs them')
    .argument('<summary>', 'one line on what needs them')
    .action(async (summary: string) => {
      printJson(await post('/api/automations/notify', { summary }));
    });
}
