/**
 * CLI markdown-panel commands — add, list, and remove markdown file panels on a
 * terminal session via the REST API. These map to the "Markdown File" tabs in
 * the UI. A terminal can hold several at once, so this is add/list/remove
 * rather than a single set/get/unset.
 */

import * as path from 'node:path';
import type { Command } from 'commander';
import { get, post, del } from '../api';
import { printJson } from '../output';
import { resolvePtyId } from '../ptyId';

function panelsUrl(ptyId: string): string {
  return `/api/panels/${encodeURIComponent(ptyId)}/markdown`;
}

export function registerMarkdownCommands(parent: Command) {
  const markdown = parent
    .command('markdown')
    .description('Manage markdown file panels on a terminal session')
    .addHelpText(
      'after',
      `
Examples:
  ouijit markdown add ./notes.md
  ouijit markdown add ./notes.md pty_abc123
  ouijit markdown list
  ouijit markdown remove ./notes.md`,
    );

  markdown
    .command('add')
    .description('Open a markdown file panel on a terminal session')
    .argument('<path>', 'path to markdown file (.md)')
    .argument('[pty-id]', 'terminal session id (defaults to OUIJIT_PTY_ID)')
    .action(async (mdPath: string, explicitPtyId?: string) => {
      const ptyId = resolvePtyId(explicitPtyId);
      const resolved = path.resolve(mdPath);
      printJson(await post(panelsUrl(ptyId), { path: resolved }));
    });

  markdown
    .command('list')
    .description('List markdown file panels on a terminal session')
    .argument('[pty-id]', 'terminal session id (defaults to OUIJIT_PTY_ID)')
    .action(async (explicitPtyId?: string) => {
      const ptyId = resolvePtyId(explicitPtyId);
      printJson(await get(panelsUrl(ptyId)));
    });

  markdown
    .command('remove')
    .description('Close a markdown file panel on a terminal session')
    .argument('<path>', 'path to the markdown file panel to close (.md)')
    .argument('[pty-id]', 'terminal session id (defaults to OUIJIT_PTY_ID)')
    .action(async (mdPath: string, explicitPtyId?: string) => {
      const ptyId = resolvePtyId(explicitPtyId);
      const resolved = path.resolve(mdPath);
      printJson(await del(`${panelsUrl(ptyId)}?path=${encodeURIComponent(resolved)}`));
    });
}
