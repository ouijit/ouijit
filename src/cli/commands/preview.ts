/**
 * CLI web-preview commands — add, list, and remove web preview panels on a
 * terminal session via the REST API. Lets an agent that started a dev server
 * open a preview tab pointed at it. A terminal can hold several previews.
 */

import type { Command } from 'commander';
import { get, post, del } from '../api';
import { printJson } from '../output';
import { resolvePtyId } from '../ptyId';

function panelsUrl(ptyId: string): string {
  return `/api/panels/${encodeURIComponent(ptyId)}/preview`;
}

export function registerPreviewCommands(parent: Command) {
  const preview = parent
    .command('preview')
    .description('Manage web preview panels on a terminal session')
    .addHelpText(
      'after',
      `
Examples:
  ouijit preview add http://localhost:3000
  ouijit preview add http://localhost:3000 pty_abc123
  ouijit preview list
  ouijit preview remove http://localhost:3000`,
    );

  preview
    .command('add')
    .description('Open a web preview panel on a terminal session')
    .argument('<url>', 'http(s) URL to preview')
    .argument('[pty-id]', 'terminal session id (defaults to OUIJIT_PTY_ID)')
    .action(async (url: string, explicitPtyId?: string) => {
      const ptyId = resolvePtyId(explicitPtyId);
      printJson(await post(panelsUrl(ptyId), { url }));
    });

  preview
    .command('list')
    .description('List web preview panels on a terminal session')
    .argument('[pty-id]', 'terminal session id (defaults to OUIJIT_PTY_ID)')
    .action(async (explicitPtyId?: string) => {
      const ptyId = resolvePtyId(explicitPtyId);
      printJson(await get(panelsUrl(ptyId)));
    });

  preview
    .command('remove')
    .description('Close a web preview panel on a terminal session')
    .argument('<url>', 'URL of the preview panel to close')
    .argument('[pty-id]', 'terminal session id (defaults to OUIJIT_PTY_ID)')
    .action(async (url: string, explicitPtyId?: string) => {
      const ptyId = resolvePtyId(explicitPtyId);
      printJson(await del(`${panelsUrl(ptyId)}?url=${encodeURIComponent(url)}`));
    });
}
