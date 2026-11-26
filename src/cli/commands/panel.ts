/**
 * CLI panel and runner commands via REST API. A runner panel runs a project
 * script in a tab beside the terminal, as the + menu does.
 */

import type { Command } from 'commander';
import { get, post, del } from '../api';
import { printError, printJson } from '../output';
import { resolvePtyId } from '../ptyId';
import { SANDBOX_FLAG, parseSandboxFlag, sandboxFlagHelp } from '../sandboxFlag';

function panelsUrl(ptyId: string): string {
  return `/api/panels/${encodeURIComponent(ptyId)}`;
}

export function registerPanelCommands(parent: Command) {
  const panel = parent
    .command('panel')
    .description("List a terminal's panels of every kind, read one, and bring one to the front")
    .addHelpText(
      'after',
      `
Examples:
  ouijit panel list
  ouijit panel read panel-3fa9 --lines 40
  ouijit panel focus panel-3fa9
  ouijit panel focus terminal`,
    );

  panel
    .command('list')
    .description("List a terminal's panels: markdown, preview and runner")
    .argument('[pty-id]', 'terminal session id (defaults to OUIJIT_PTY_ID)')
    .action(async (explicitPtyId?: string) => {
      printJson(await get(panelsUrl(resolvePtyId(explicitPtyId))));
    });

  panel
    .command('read')
    .description(
      "Show a runner's screen as text, with its status and exit code; a markdown or preview panel's path or url",
    )
    .argument('<id>', 'a panel id from `panel list`')
    .argument('[pty-id]', 'terminal session id (defaults to OUIJIT_PTY_ID)')
    .option('--lines <n>', 'how many lines from the bottom (default 100)')
    .action(async (id: string, explicitPtyId: string | undefined, opts: { lines?: string }) => {
      const query = opts.lines === undefined ? '' : `?lines=${encodeURIComponent(opts.lines)}`;
      printJson(await get(`${panelsUrl(resolvePtyId(explicitPtyId))}/${encodeURIComponent(id)}/screen${query}`));
    });

  panel
    .command('focus')
    .description('Bring a panel to the front, or the terminal itself with `terminal`')
    .argument('<id>', 'a panel id from `panel list`, or terminal')
    .argument('[pty-id]', 'terminal session id (defaults to OUIJIT_PTY_ID)')
    .action(async (id: string, explicitPtyId?: string) => {
      printJson(await post(`${panelsUrl(resolvePtyId(explicitPtyId))}/focus`, { id }));
    });

  const runner = parent
    .command('runner')
    .description('Run project scripts in panels beside a terminal')
    .addHelpText(
      'after',
      `
Examples:
  ouijit runner add "Dev server"
  ouijit runner shell
  ouijit runner list
  ouijit runner remove "Dev server"`,
    );

  runner
    .command('add')
    .description(
      "Run a script in a panel on a terminal, in the project's default sandbox; from a sandbox, in its own, or on the host once the user approves",
    )
    .argument('<script>', 'script id or name, from `script list`')
    .argument('[pty-id]', 'terminal session id (defaults to OUIJIT_PTY_ID)')
    .option(SANDBOX_FLAG, sandboxFlagHelp('where it runs'))
    .option('-m, --message <why>', 'why, for the user, when it waits for approval')
    .action(async (script: string, explicitPtyId: string | undefined, opts: { sandbox?: string; message?: string }) => {
      const parsed = parseSandboxFlag(opts.sandbox);
      if ('error' in parsed) return printError(parsed.error);
      printJson(
        await post(`${panelsUrl(resolvePtyId(explicitPtyId))}/runner`, {
          script,
          ...parsed,
          ...(opts.message && { message: opts.message }),
        }),
      );
    });

  runner
    .command('shell')
    .description(
      "Open a shell in a panel on a terminal, in its worktree, in the project's default sandbox; from a sandbox, only in its own",
    )
    .argument('[pty-id]', 'terminal session id (defaults to OUIJIT_PTY_ID)')
    .option(SANDBOX_FLAG, sandboxFlagHelp('where it runs'))
    .action(async (explicitPtyId: string | undefined, opts: { sandbox?: string }) => {
      const parsed = parseSandboxFlag(opts.sandbox);
      if ('error' in parsed) return printError(parsed.error);
      printJson(await post(`${panelsUrl(resolvePtyId(explicitPtyId))}/runner`, { shell: true, ...parsed }));
    });

  runner
    .command('list')
    .description("List a terminal's runner panels")
    .argument('[pty-id]', 'terminal session id (defaults to OUIJIT_PTY_ID)')
    .action(async (explicitPtyId?: string) => {
      printJson(await get(`${panelsUrl(resolvePtyId(explicitPtyId))}/runner`));
    });

  runner
    .command('remove')
    .description('Close a runner panel, stopping its script')
    .argument('<script>', 'script id or name')
    .argument('[pty-id]', 'terminal session id (defaults to OUIJIT_PTY_ID)')
    .action(async (script: string, explicitPtyId?: string) => {
      printJson(await del(`${panelsUrl(resolvePtyId(explicitPtyId))}/runner?script=${encodeURIComponent(script)}`));
    });
}
