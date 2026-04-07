/**
 * CLI script commands — CRUD + execution for run scripts via REST API.
 */

import type { Command } from 'commander';
import { get, put, del, projectQuery } from '../api';
import { printJson, printError } from '../output';
import { spawn } from 'node:child_process';

interface ScriptEntry {
  id: string;
  name: string;
  command: string;
  sortOrder: number;
}

interface TaskEntry {
  worktreePath?: string;
}

export function registerScriptCommands(parent: Command, requireProject: () => string) {
  const script = parent
    .command('script')
    .description('Manage and run scripts')
    .addHelpText(
      'after',
      `
Examples:
  ouijit script list
  ouijit script set --name "Lint" --command "npm run lint"
  ouijit script delete <id>
  ouijit script run <id-or-name>
  ouijit script run <id-or-name> --task 5`,
    );

  script
    .command('list')
    .description('List all scripts (JSON array)')
    .action(async () => {
      const project = requireProject();
      const scripts = await get(`/api/scripts${projectQuery(project)}`);
      printJson(scripts);
    });

  script
    .command('set')
    .description('Create or update a script')
    .requiredOption('--name <name>', 'script name')
    .requiredOption('--command <cmd>', 'shell command to run')
    .option('--id <id>', 'script id (updates existing if provided)')
    .action(async (opts: { name: string; command: string; id?: string }) => {
      const project = requireProject();
      const result = await put<{ success: boolean; script?: ScriptEntry }>(
        `/api/scripts/${encodeURIComponent(opts.id || '')}${projectQuery(project)}`,
        { id: opts.id || '', name: opts.name, command: opts.command, sortOrder: 0 },
      );
      if (!result.success) return printError('Failed to save script');
      printJson(result.script);
    });

  script
    .command('delete')
    .description('Delete a script')
    .argument('<id>', 'script id')
    .action(async (id: string) => {
      const project = requireProject();
      const result = await del<{ success: boolean }>(`/api/scripts/${encodeURIComponent(id)}${projectQuery(project)}`);
      if (!result.success) return printError('Failed to delete script');
      printJson(result);
    });

  script
    .command('run')
    .description('Execute a script by id or name')
    .argument('<id-or-name>', 'script id or name')
    .option('--task <number>', 'run in task worktree directory')
    .action(async (idOrName: string, opts: { task?: string }) => {
      const project = requireProject();

      // Resolve the script
      const scripts = await get<ScriptEntry[]>(`/api/scripts${projectQuery(project)}`);
      const found = scripts.find((s) => s.id === idOrName || s.name === idOrName);
      if (!found) return printError(`Script not found: ${idOrName}`);

      // Resolve working directory
      let cwd = project;
      if (opts.task) {
        const num = parseInt(opts.task, 10);
        if (isNaN(num)) return printError('--task must be a number');
        const task = await get<TaskEntry | null>(`/api/tasks/${num}${projectQuery(project)}`);
        if (!task) return printError(`Task ${num} not found`);
        if (task.worktreePath) cwd = task.worktreePath;
      }

      // Execute and stream output
      const child = spawn(found.command, [], {
        cwd,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, OUIJIT_SCRIPT_NAME: found.name },
      });

      child.stdout?.pipe(process.stdout);
      child.stderr?.pipe(process.stderr);

      child.on('close', (exitCode) => {
        process.exit(exitCode ?? 1);
      });

      child.on('error', (err) => {
        return printError(`Failed to run script: ${err.message}`);
      });
    });
}
