import { readFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { SandboxBackendId, SandboxCliAccess } from './sandbox/types';

/**
 * The CLI reference an agent's wrapper loads, with a section on top for a
 * sandboxed terminal. The wrappers read it from under `~/.config/Ouijit`,
 * which the nono sandbox grants.
 */
export function getCliReferencePath(sandbox?: SandboxReference): string {
  const name = sandbox ? `ouijit-cli-reference-${sandbox.provider}-${sandbox.access}.md` : 'ouijit-cli-reference.md';
  return path.join(os.homedir(), '.config', 'Ouijit', name);
}

export interface SandboxReference {
  provider: SandboxBackendId;
  access: SandboxCliAccess;
}

/** A CLI reference file's text, or empty where it has not been written. */
export function readCliReference(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}
