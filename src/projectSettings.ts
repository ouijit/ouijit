import { app } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ProjectSettings, CustomCommand } from './types';

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
  return settings[projectPath] || { customCommands: [] };
}

/**
 * Save a custom command for a project
 */
export async function saveCustomCommand(
  projectPath: string,
  command: CustomCommand
): Promise<{ success: boolean }> {
  try {
    const settings = await loadSettings();
    const projectSettings = settings[projectPath] || { customCommands: [] };

    // Check if command with same ID exists (update) or add new
    const existingIndex = projectSettings.customCommands.findIndex(c => c.id === command.id);
    if (existingIndex >= 0) {
      projectSettings.customCommands[existingIndex] = command;
    } else {
      projectSettings.customCommands.push(command);
    }

    settings[projectPath] = projectSettings;
    await saveSettings(settings);
    return { success: true };
  } catch (error) {
    console.error('Failed to save custom command:', error);
    return { success: false };
  }
}

/**
 * Delete a custom command
 */
export async function deleteCustomCommand(
  projectPath: string,
  commandId: string
): Promise<{ success: boolean }> {
  try {
    const settings = await loadSettings();
    const projectSettings = settings[projectPath];

    if (!projectSettings) {
      return { success: true };
    }

    projectSettings.customCommands = projectSettings.customCommands.filter(
      c => c.id !== commandId
    );

    // Clear default if it was the deleted command
    if (projectSettings.defaultCommandId === commandId) {
      projectSettings.defaultCommandId = undefined;
    }

    settings[projectPath] = projectSettings;
    await saveSettings(settings);
    return { success: true };
  } catch (error) {
    console.error('Failed to delete custom command:', error);
    return { success: false };
  }
}

/**
 * Set the default command for a project
 */
export async function setDefaultCommand(
  projectPath: string,
  commandId: string | null
): Promise<{ success: boolean }> {
  try {
    const settings = await loadSettings();
    const projectSettings = settings[projectPath] || { customCommands: [] };

    projectSettings.defaultCommandId = commandId || undefined;
    settings[projectPath] = projectSettings;
    await saveSettings(settings);
    return { success: true };
  } catch (error) {
    console.error('Failed to set default command:', error);
    return { success: false };
  }
}
