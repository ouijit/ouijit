import { getGlobalSetting, setGlobalSetting } from '../../db';
import { getLogger } from '../../logger';
import type { NonoConfig } from './argv';

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
