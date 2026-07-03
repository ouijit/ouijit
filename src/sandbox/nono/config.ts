import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { getGlobalSetting, setGlobalSetting } from '../../db';
import { getLogger } from '../../logger';
import type { NonoConfig } from '../types';

const nonoLog = getLogger().scope('nono');

/** Global-settings key holding a project's nono config JSON. */
export function nonoConfigKey(projectPath: string): string {
  return `nono:${projectPath}`;
}

/**
 * Read a project's nono config. Returns an empty config (nono defaults) when
 * unset or unparseable, so a corrupt value never blocks a spawn.
 */
export async function getNonoConfig(projectPath: string): Promise<NonoConfig> {
  const raw = await getGlobalSetting(nonoConfigKey(projectPath));
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as NonoConfig;
    return {
      profile: typeof parsed.profile === 'string' ? parsed.profile : undefined,
      blockNet: parsed.blockNet === true,
      openPorts: Array.isArray(parsed.openPorts) ? parsed.openPorts.filter((p) => Number.isInteger(p)) : undefined,
      allowPaths: Array.isArray(parsed.allowPaths)
        ? parsed.allowPaths.filter((p) => typeof p === 'string' && p.length > 0)
        : undefined,
    };
  } catch (error) {
    nonoLog.warn('failed to parse nono config; using defaults', {
      projectPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

export async function setNonoConfig(projectPath: string, config: NonoConfig): Promise<{ success: boolean }> {
  return setGlobalSetting(nonoConfigKey(projectPath), JSON.stringify(config));
}

/**
 * List named nono profiles the user has installed. nono resolves `--profile`
 * names against `~/.config/nono/profiles`; we surface them so the settings UI
 * can offer a picker. Returns an empty list when the dir is absent.
 */
export async function listNonoProfiles(): Promise<string[]> {
  const dir = path.join(os.homedir(), '.config', 'nono', 'profiles');
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && /\.(json|toml|ya?ml)$/i.test(e.name))
      .map((e) => e.name.replace(/\.(json|toml|ya?ml)$/i, ''))
      .sort();
  } catch {
    return [];
  }
}
