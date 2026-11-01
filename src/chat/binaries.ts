import { execFile } from 'node:child_process';
import { accessSync, constants, readFileSync, realpathSync } from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { getWrapperBinDir } from '../paths';
import { getCliReferencePath } from '../hookServer';

const execFileAsync = promisify(execFile);

function realpath(file: string): string {
  try {
    return realpathSync(file);
  } catch {
    return file;
  }
}

/**
 * The agent's own binary, skipping Ouijit's wrapper of the same name. A chat
 * driver takes status from the agent's protocol, so the wrapper's status hooks
 * would only report it twice.
 */
export function resolveAgentBinary(name: string, envPath = process.env.PATH ?? ''): string | null {
  const wrapperDir = realpath(getWrapperBinDir());
  for (const dir of envPath.split(path.delimiter)) {
    if (!dir || realpath(dir) === wrapperDir) continue;
    const candidate = path.join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

/** The first version-shaped token a binary prints, or undefined if it will not say. */
export async function binaryVersion(file: string, args = ['--version']): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(file, args, { timeout: 10_000 });
    return stdout.match(/\d+\.\d+\.\d+[\w.-]*/)?.[0];
  } catch {
    return undefined;
  }
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const pb = b.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

/** The Ouijit CLI reference the terminal wrappers hand every agent, so a chat agent knows it too. */
export function ouijitInstructions(): string {
  try {
    return readFileSync(getCliReferencePath(), 'utf8');
  } catch {
    return '';
  }
}
