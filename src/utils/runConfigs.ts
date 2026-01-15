import type { RunConfig, CustomCommand } from '../types';

/**
 * Generates a unique ID for a detected run config (for default selection)
 */
export function getConfigId(config: RunConfig): string {
  return config.isCustom ? config.name : `${config.source}:${config.name}`;
}

/**
 * Converts custom commands to RunConfig format
 */
export function customCommandsToRunConfigs(customCommands: CustomCommand[]): RunConfig[] {
  return customCommands.map(cmd => ({
    name: cmd.name,
    command: cmd.command,
    source: 'custom' as const,
    description: cmd.description,
    priority: 0,
    isCustom: true,
  }));
}

/**
 * Merges detected run configs with custom commands
 * Custom commands appear first, then detected configs
 */
export function mergeRunConfigs(
  detectedConfigs: RunConfig[] | undefined,
  customCommands: CustomCommand[]
): RunConfig[] {
  const customConfigs = customCommandsToRunConfigs(customCommands);
  const detected = detectedConfigs || [];
  return [...customConfigs, ...detected];
}
