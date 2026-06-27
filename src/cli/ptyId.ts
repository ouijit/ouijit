/**
 * Resolve the target terminal session id for pty-scoped CLI commands.
 * Prefers an explicit argument, falling back to OUIJIT_PTY_ID (set by the app
 * for every terminal it spawns). Exits with a JSON error when neither is set.
 */

import { printError } from './output';

export function resolvePtyId(explicitPtyId?: string): string {
  const ptyId = explicitPtyId || process.env['OUIJIT_PTY_ID'];
  if (!ptyId) {
    return printError('No pty-id provided and OUIJIT_PTY_ID not set. Provide <pty-id> or run from an Ouijit terminal.');
  }
  return ptyId;
}
