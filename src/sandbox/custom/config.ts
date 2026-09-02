import { getGlobalSetting, setGlobalSetting } from '../../db';
import { getLogger } from '../../logger';
import type { CustomSandboxConfig } from '../types';
import { resolveCommandTokens } from './argv';

const customLog = getLogger().scope('customSandbox');

/** Global-settings key holding a project's custom sandbox config JSON. */
export function customSandboxConfigKey(projectPath: string): string {
  return `customSandbox:${projectPath}`;
}

/**
 * Read a project's custom sandbox config. Anything but a non-empty string
 * command reads as unset, which makes the spawn refuse loudly rather than fall
 * back to a host shell.
 */
export async function getCustomSandboxConfig(projectPath: string): Promise<CustomSandboxConfig> {
  const raw = await getGlobalSetting(customSandboxConfigKey(projectPath));
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    customLog.warn('failed to parse custom sandbox config; treating as unset', {
      projectPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null) return {};
  const command = (parsed as { command?: unknown }).command;
  const trimmed = typeof command === 'string' ? command.trim() : '';
  return trimmed.length > 0 ? { command: trimmed } : {};
}

/**
 * Persist a project's launcher. Every writer (settings card, REST, CLI) goes
 * through here so a stored command is always one `prepare` will accept; an
 * empty command clears the setting.
 */
export async function setCustomSandboxConfig(
  projectPath: string,
  config: CustomSandboxConfig,
): Promise<{ success: boolean; error?: string }> {
  const command = config.command?.trim() ?? '';
  if (command.length > 0) {
    try {
      resolveCommandTokens(command);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  const stored: CustomSandboxConfig = command.length > 0 ? { command } : {};
  return setGlobalSetting(customSandboxConfigKey(projectPath), JSON.stringify(stored));
}
