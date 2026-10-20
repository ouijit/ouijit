/**
 * CLI tag commands — read and set the tag on a terminal session via the REST
 * API. A terminal carries one tag, as in the tag input on its card.
 */

import type { Command } from 'commander';
import { get, put, del } from '../api';
import { printJson } from '../output';
import { resolvePtyId } from '../ptyId';

function tagsUrl(ptyId: string): string {
  return `/api/terminals/${encodeURIComponent(ptyId)}/tags`;
}

export function registerTagCommands(parent: Command) {
  const tag = parent
    .command('tag')
    .description('Manage terminal tags')
    .addHelpText(
      'after',
      `
Examples:
  ouijit tag list
  ouijit tag get
  ouijit tag set review
  ouijit tag set review pty_abc123
  ouijit tag clear`,
    );

  tag
    .command('list')
    .description('List the tags on open terminals, with the terminals that carry each')
    .action(async () => {
      printJson(await get('/api/tags'));
    });

  tag
    .command('get')
    .description("Show a terminal's tags")
    .argument('[pty-id]', 'terminal session id (defaults to OUIJIT_PTY_ID)')
    .action(async (explicitPtyId?: string) => {
      printJson(await get(tagsUrl(resolvePtyId(explicitPtyId))));
    });

  tag
    .command('set')
    .description("Set a terminal's tag, replacing any it had")
    .argument('<tag>', 'tag name')
    .argument('[pty-id]', 'terminal session id (defaults to OUIJIT_PTY_ID)')
    .action(async (tagName: string, explicitPtyId?: string) => {
      printJson(await put(tagsUrl(resolvePtyId(explicitPtyId)), { tag: tagName }));
    });

  tag
    .command('clear')
    .description("Remove a terminal's tag")
    .argument('[pty-id]', 'terminal session id (defaults to OUIJIT_PTY_ID)')
    .action(async (explicitPtyId?: string) => {
      printJson(await del(tagsUrl(resolvePtyId(explicitPtyId))));
    });
}
