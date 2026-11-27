/**
 * CLI browser commands: add, list and remove browser tabs on a terminal via the
 * REST API. A terminal can hold several.
 */

import type { Command } from 'commander';
import { get, post, del } from '../api';
import { printJson } from '../output';
import { resolvePtyId } from '../ptyId';

function panelsUrl(ptyId: string): string {
  return `/api/panels/${encodeURIComponent(ptyId)}/browser`;
}

export function registerBrowserCommands(parent: Command) {
  const browser = parent
    .command('browser')
    .description('Manage browser tabs on a terminal session')
    .addHelpText(
      'after',
      `
Examples:
  ouijit browser add http://localhost:3000
  ouijit browser add http://localhost:3000 pty_abc123
  ouijit browser list
  ouijit browser remove http://localhost:3000`,
    );

  browser
    .command('add')
    .description('Open a browser tab on a terminal session; from a sandbox, a page off localhost waits for approval')
    .argument('<url>', 'http(s) URL to open')
    .argument('[pty-id]', 'terminal session id (defaults to OUIJIT_PTY_ID)')
    .option('-m, --message <why>', 'why, for the user, when it waits for approval')
    .action(async (url: string, explicitPtyId: string | undefined, opts: { message?: string }) => {
      const ptyId = resolvePtyId(explicitPtyId);
      printJson(await post(panelsUrl(ptyId), { url, ...(opts.message && { message: opts.message }) }));
    });

  browser
    .command('list')
    .description('List browser tabs on a terminal session')
    .argument('[pty-id]', 'terminal session id (defaults to OUIJIT_PTY_ID)')
    .action(async (explicitPtyId?: string) => {
      const ptyId = resolvePtyId(explicitPtyId);
      printJson(await get(panelsUrl(ptyId)));
    });

  browser
    .command('remove')
    .description('Close a browser tab on a terminal session')
    .argument('<url>', 'URL of the tab to close')
    .argument('[pty-id]', 'terminal session id (defaults to OUIJIT_PTY_ID)')
    .action(async (url: string, explicitPtyId?: string) => {
      const ptyId = resolvePtyId(explicitPtyId);
      printJson(await del(`${panelsUrl(ptyId)}?url=${encodeURIComponent(url)}`));
    });
}
