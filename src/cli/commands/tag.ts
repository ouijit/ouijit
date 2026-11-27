/**
 * CLI tag commands — add, list, and remove the tags on a terminal session via
 * the REST API, as the tag input on its card does.
 */

import type { Command } from 'commander';
import { get, post, del } from '../api';
import { printJson } from '../output';
import { resolveSessionId } from '../sessionId';

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
  ouijit tag add review
  ouijit tag add review pty_abc123
  ouijit tag remove review
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
    .argument('[session-id]', 'session id (defaults to OUIJIT_SESSION_ID)')
    .action(async (explicitSessionId?: string) => {
      printJson(await get(tagsUrl(resolveSessionId(explicitSessionId))));
    });

  tag
    .command('add')
    .description('Add a tag to a terminal')
    .argument('<tag>', 'tag name')
    .argument('[session-id]', 'session id (defaults to OUIJIT_SESSION_ID)')
    .action(async (tagName: string, explicitSessionId?: string) => {
      printJson(await post(tagsUrl(resolveSessionId(explicitSessionId)), { tag: tagName }));
    });

  tag
    .command('remove')
    .description('Remove a tag from a terminal')
    .argument('<tag>', 'tag name')
    .argument('[session-id]', 'session id (defaults to OUIJIT_SESSION_ID)')
    .action(async (tagName: string, explicitSessionId?: string) => {
      printJson(await del(`${tagsUrl(resolveSessionId(explicitSessionId))}/${encodeURIComponent(tagName)}`));
    });

  tag
    .command('clear')
    .description("Remove all of a terminal's tags")
    .argument('[session-id]', 'session id (defaults to OUIJIT_SESSION_ID)')
    .action(async (explicitSessionId?: string) => {
      printJson(await del(tagsUrl(resolveSessionId(explicitSessionId))));
    });
}
