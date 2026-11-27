/**
 * CLI panel commands via REST API: the tabs beside a terminal, of every kind.
 */

import * as path from 'node:path';
import type { Command } from 'commander';
import { get, post } from '../api';
import { printError, printJson } from '../output';
import { resolveSessionId } from '../sessionId';
import { SANDBOX_FLAG, parseSandboxFlag, sandboxFlagHelp } from '../sandboxFlag';

function panelsUrl(ptyId: string): string {
  return `/api/panels/${encodeURIComponent(ptyId)}`;
}

export function registerPanelCommands(parent: Command) {
  const panel = parent
    .command('panel')
    .description('Open, list, read, focus and close the tabs beside a terminal')
    .addHelpText(
      'after',
      `
Examples:
  ouijit panel open markdown ./plan.md
  ouijit panel open browser http://localhost:3000
  ouijit panel open script "Dev server"
  ouijit panel open shell
  ouijit panel list
  ouijit panel read panel-3fa9 --lines 40
  ouijit panel focus terminal
  ouijit panel close panel-3fa9`,
    );

  panel
    .command('list')
    .description("List a terminal's panels: markdown, browser, script and shell")
    .argument('[session-id]', 'session id (defaults to OUIJIT_SESSION_ID)')
    .action(async (explicitSessionId?: string) => {
      printJson(await get(panelsUrl(resolveSessionId(explicitSessionId))));
    });

  panel
    .command('read')
    .description(
      "Show a script or shell panel's screen as text, with its status and exit code; a markdown or browser panel's path or url",
    )
    .argument('<id>', 'a panel id from `panel list`')
    .argument('[session-id]', 'session id (defaults to OUIJIT_SESSION_ID)')
    .option('--lines <n>', 'how many lines from the bottom (default 100)')
    .action(async (id: string, explicitSessionId: string | undefined, opts: { lines?: string }) => {
      const query = opts.lines === undefined ? '' : `?lines=${encodeURIComponent(opts.lines)}`;
      printJson(
        await get(`${panelsUrl(resolveSessionId(explicitSessionId))}/${encodeURIComponent(id)}/screen${query}`),
      );
    });

  panel
    .command('focus')
    .description('Bring a panel to the front, or the terminal itself with `terminal`')
    .argument('<id>', 'a panel id from `panel list`, or terminal')
    .argument('[session-id]', 'session id (defaults to OUIJIT_SESSION_ID)')
    .action(async (id: string, explicitSessionId?: string) => {
      printJson(await post(`${panelsUrl(resolveSessionId(explicitSessionId))}/focus`, { id }));
    });

  panel
    .command('close')
    .description('Close a panel, stopping what runs in it')
    .argument('<id>', 'a panel id from `panel list`')
    .argument('[session-id]', 'session id (defaults to OUIJIT_SESSION_ID)')
    .action(async (id: string, explicitSessionId?: string) => {
      printJson(await post(`${panelsUrl(resolveSessionId(explicitSessionId))}/close`, { id }));
    });

  const open = panel.command('open').description('Open a panel on a terminal, or bring forward the one already open');

  open
    .command('markdown')
    .description('A markdown file, rendered')
    .argument('<path>', 'path to a .md file')
    .argument('[session-id]', 'session id (defaults to OUIJIT_SESSION_ID)')
    .action(async (mdPath: string, explicitSessionId?: string) => {
      printJson(
        await post(`${panelsUrl(resolveSessionId(explicitSessionId))}/markdown`, { path: path.resolve(mdPath) }),
      );
    });

  open
    .command('browser')
    .description('A browser tab; from a sandbox, a page off localhost waits for approval')
    .argument('<url>', 'http(s) URL to open')
    .argument('[session-id]', 'session id (defaults to OUIJIT_SESSION_ID)')
    .option('-m, --message <why>', 'why, for the user, when it waits for approval')
    .action(async (url: string, explicitSessionId: string | undefined, opts: { message?: string }) => {
      printJson(
        await post(`${panelsUrl(resolveSessionId(explicitSessionId))}/browser`, {
          url,
          ...(opts.message && { message: opts.message }),
        }),
      );
    });

  open
    .command('script')
    .description(
      "A project script, running in the project's default sandbox; from a sandbox, in its own, or anywhere else once the user approves",
    )
    .argument('<script>', 'script id or name, from `script list`')
    .argument('[session-id]', 'session id (defaults to OUIJIT_SESSION_ID)')
    .option(SANDBOX_FLAG, sandboxFlagHelp('where it runs'))
    .option('-m, --message <why>', 'why, for the user, when it waits for approval')
    .action(
      async (script: string, explicitSessionId: string | undefined, opts: { sandbox?: string; message?: string }) => {
        const parsed = parseSandboxFlag(opts.sandbox);
        if ('error' in parsed) return printError(parsed.error);
        printJson(
          await post(`${panelsUrl(resolveSessionId(explicitSessionId))}/runner`, {
            script,
            ...parsed,
            ...(opts.message && { message: opts.message }),
          }),
        );
      },
    );

  open
    .command('shell')
    .description(
      "A shell in the terminal's worktree, in the project's default sandbox; from a sandbox, in its own, or anywhere else once the user approves",
    )
    .argument('[session-id]', 'session id (defaults to OUIJIT_SESSION_ID)')
    .option(SANDBOX_FLAG, sandboxFlagHelp('where it runs'))
    .option('-m, --message <why>', 'why, for the user, when it waits for approval')
    .action(async (explicitSessionId: string | undefined, opts: { sandbox?: string; message?: string }) => {
      const parsed = parseSandboxFlag(opts.sandbox);
      if ('error' in parsed) return printError(parsed.error);
      printJson(
        await post(`${panelsUrl(resolveSessionId(explicitSessionId))}/runner`, {
          shell: true,
          ...parsed,
          ...(opts.message && { message: opts.message }),
        }),
      );
    });
}
