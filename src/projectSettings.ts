import { app } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ProjectSettings, ScriptHook, HookType } from './types';

const SETTINGS_FILE = 'project-settings.json';

/**
 * Map of project paths to their settings
 */
interface SettingsStore {
  [projectPath: string]: ProjectSettings;
}

let settingsCache: SettingsStore | null = null;

/**
 * Get the path to the settings file
 */
function getSettingsPath(): string {
  return path.join(app.getPath('userData'), SETTINGS_FILE);
}

/**
 * Load all settings from disk
 */
async function loadSettings(): Promise<SettingsStore> {
  if (settingsCache) {
    return settingsCache;
  }

  try {
    const content = await fs.readFile(getSettingsPath(), 'utf-8');
    settingsCache = JSON.parse(content);
    return settingsCache!;
  } catch {
    settingsCache = {};
    return settingsCache;
  }
}

/**
 * Save all settings to disk
 */
async function saveSettings(settings: SettingsStore): Promise<void> {
  settingsCache = settings;
  await fs.writeFile(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf-8');
}

/**
 * Get settings for a specific project
 */
export async function getProjectSettings(projectPath: string): Promise<ProjectSettings> {
  const settings = await loadSettings();
  return settings[projectPath] || { customCommands: [], hooks: {} };
}

/**
 * Get all hooks for a project
 */
export async function getHooks(
  projectPath: string
): Promise<{ init?: ScriptHook; run?: ScriptHook; cleanup?: ScriptHook }> {
  const settings = await getProjectSettings(projectPath);
  return settings.hooks || {};
}

/**
 * Get a specific hook for a project
 */
export async function getHook(
  projectPath: string,
  hookType: HookType
): Promise<ScriptHook | undefined> {
  const hooks = await getHooks(projectPath);
  return hooks[hookType];
}

/**
 * Save a hook for a project
 */
export async function saveHook(
  projectPath: string,
  hook: ScriptHook
): Promise<{ success: boolean }> {
  try {
    const settings = await loadSettings();
    const projectSettings = settings[projectPath] || { customCommands: [], hooks: {} };

    if (!projectSettings.hooks) {
      projectSettings.hooks = {};
    }

    projectSettings.hooks[hook.type] = hook;
    settings[projectPath] = projectSettings;
    await saveSettings(settings);
    return { success: true };
  } catch (error) {
    console.error('Failed to save hook:', error);
    return { success: false };
  }
}

/**
 * Delete a hook for a project
 */
export async function deleteHook(
  projectPath: string,
  hookType: HookType
): Promise<{ success: boolean }> {
  try {
    const settings = await loadSettings();
    const projectSettings = settings[projectPath];

    if (!projectSettings?.hooks) {
      return { success: true };
    }

    delete projectSettings.hooks[hookType];
    settings[projectPath] = projectSettings;
    await saveSettings(settings);
    return { success: true };
  } catch (error) {
    console.error('Failed to delete hook:', error);
    return { success: false };
  }
}

/**
 * Set whether to kill existing command instances on run
 */
export async function setKillExistingOnRun(
  projectPath: string,
  kill: boolean
): Promise<{ success: boolean }> {
  try {
    const settings = await loadSettings();
    const projectSettings = settings[projectPath] || { customCommands: [], hooks: {} };

    projectSettings.killExistingOnRun = kill;
    settings[projectPath] = projectSettings;
    await saveSettings(settings);
    return { success: true };
  } catch (error) {
    console.error('Failed to set killExistingOnRun:', error);
    return { success: false };
  }
}
