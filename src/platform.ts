/**
 * Platform abstractions — decouples business logic from Electron shell APIs.
 *
 * Default: rm -rf fallback (safe for CLI).
 * Electron app overrides via setTrashItem() with shell.trashItem.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

async function defaultTrash(p: string): Promise<void> {
  await execAsync(`rm -rf ${JSON.stringify(p)}`);
}

let _trashItem: (p: string) => Promise<void> = defaultTrash;

export function setTrashItem(fn: (p: string) => Promise<void>): void {
  _trashItem = fn;
}

export function trashItem(p: string): Promise<void> {
  return _trashItem(p);
}
