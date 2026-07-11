/**
 * CLI theme commands — global appearance settings via REST API.
 *
 * Themes are app-wide, not project-scoped. A custom theme is a set of design
 * token overrides on top of the dark or light base; the presets returned by
 * `theme list` double as reference for the token vocabulary.
 */

import * as fs from 'node:fs';
import type { Command } from 'commander';
import { get, put, del } from '../api';
import { printJson, printError } from '../output';
import { isThemePreference } from '../../theme/themes';

export function registerThemeCommands(parent: Command) {
  const theme = parent
    .command('theme')
    .description('Manage app themes (global, not project-scoped)')
    .addHelpText(
      'after',
      `
Examples:
  ouijit theme list
  ouijit theme use dracula
  ouijit theme use system
  ouijit theme save '{"id":"my-theme","name":"My Theme","base":"dark","tokens":{"--color-accent":"#ff2d55"}}'
  ouijit theme save --file my-theme.json
  ouijit theme delete my-theme`,
    );

  theme
    .command('list')
    .description('List the current preference, built-in presets, and custom themes')
    .action(async () => {
      printJson(await get('/api/themes'));
    });

  theme
    .command('use')
    .description('Select a theme')
    .argument('<theme>', 'system | light | dark | a preset or custom theme id (e.g. dracula)')
    .action(async (value: string) => {
      // A bare id ("dracula") is shorthand for the custom:<id> form.
      const preference = isThemePreference(value) ? value : `custom:${value}`;
      printJson(await put('/api/themes/preference', { preference }));
    });

  theme
    .command('save')
    .description('Create or update a custom theme from JSON')
    .argument('[json]', 'theme JSON: {"id", "name", "base": "dark"|"light", "tokens": {"--token": "value", ...}}')
    .option('--file <path>', 'read the theme JSON from a file instead of an argument')
    .action(async (jsonArg: string | undefined, opts: { file?: string }) => {
      let raw = jsonArg;
      if (opts.file) {
        try {
          raw = fs.readFileSync(opts.file, 'utf8');
        } catch (err) {
          return printError(`Cannot read ${opts.file}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (!raw) return printError('Provide theme JSON as an argument or via --file <path>');
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return printError('Not valid JSON');
      }
      const id = (parsed as { id?: unknown } | null)?.id;
      if (typeof id !== 'string' || !id) return printError('Theme JSON needs a string "id"');
      printJson(await put(`/api/themes/custom/${encodeURIComponent(id)}`, parsed as Record<string, unknown>));
    });

  theme
    .command('delete')
    .description('Delete a custom theme')
    .argument('<id>', 'custom theme id')
    .action(async (id: string) => {
      printJson(await del(`/api/themes/custom/${encodeURIComponent(id)}`));
    });
}
