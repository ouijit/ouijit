/**
 * CLI plan commands — get and set plan file for a terminal session via REST API.
 */

import type { Command } from 'commander';
import { get, post } from '../api';
import { printJson, printError } from '../output';

function resolvePtyId(explicitPtyId?: string): string {
  const ptyId = explicitPtyId || process.env['OUIJIT_PTY_ID'];
  if (!ptyId) {
    return printError('No pty-id provided and OUIJIT_PTY_ID not set. Provide <pty-id> or run from an Ouijit terminal.');
  }
  return ptyId;
}

export function registerPlanCommands(parent: Command, _requireProject: () => string) {
  const plan = parent
    .command('plan')
    .description('Manage plan files for terminal sessions')
    .addHelpText(
      'after',
      `
Examples:
  ouijit plan set ./plan.md
  ouijit plan set ./plan.md pty_abc123
  ouijit plan get
  ouijit plan get pty_abc123`,
    );

  plan
    .command('set')
    .description('Set plan file for a terminal session')
    .argument('<path>', 'path to plan file (.md)')
    .argument('[pty-id]', 'terminal session id (defaults to OUIJIT_PTY_ID)')
    .action(async (planPath: string, explicitPtyId?: string) => {
      const ptyId = resolvePtyId(explicitPtyId);
      const result = await post(`/api/plan/${encodeURIComponent(ptyId)}`, { path: planPath });
      printJson(result);
    });

  plan
    .command('get')
    .description('Get plan file path for a terminal session')
    .argument('[pty-id]', 'terminal session id (defaults to OUIJIT_PTY_ID)')
    .action(async (explicitPtyId?: string) => {
      const ptyId = resolvePtyId(explicitPtyId);
      const result = await get(`/api/plan/${encodeURIComponent(ptyId)}`);
      printJson(result);
    });
}
