import { ipcMain, app, BrowserWindow } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { SandboxSettings, SandboxStatus } from './types';
import { isLimaInstalled, getInstance, getInstanceName, stopInstance, stopAllInstances } from './manager';
import { spawnSandboxedPty, cleanupSandboxPtys } from './spawn';

export { spawnSandboxedPty, isSandboxPty, writeSandboxPty, resizeSandboxPty, killSandboxPty } from './spawn';

const SETTINGS_FILE = 'lima-settings.json';

interface LimaSettingsStore {
  [projectPath: string]: SandboxSettings;
}

let settingsCache: LimaSettingsStore | null = null;

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), SETTINGS_FILE);
}

async function loadSettings(): Promise<LimaSettingsStore> {
  if (settingsCache) return settingsCache;
  try {
    const content = await fs.readFile(getSettingsPath(), 'utf-8');
    settingsCache = JSON.parse(content);
    return settingsCache!;
  } catch {
    settingsCache = {};
    return settingsCache;
  }
}

async function saveSettings(settings: LimaSettingsStore): Promise<void> {
  settingsCache = settings;
  await fs.writeFile(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf-8');
}

/**
 * Check if sandbox is enabled for a project
 */
export async function shouldSandbox(projectPath: string): Promise<boolean> {
  const settings = await loadSettings();
  return settings[projectPath]?.enabled ?? false;
}


/**
 * Register Lima-specific IPC handlers
 */
export function registerLimaHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle('lima:status', async (_event, projectPath: string): Promise<SandboxStatus> => {
    const available = await isLimaInstalled();
    if (!available) {
      return { available: false, enabled: false, vmStatus: 'Unavailable' };
    }

    const settings = await loadSettings();
    const enabled = settings[projectPath]?.enabled ?? false;

    if (!enabled) {
      return { available: true, enabled: false, vmStatus: 'NotCreated' };
    }

    const instanceName = getInstanceName(projectPath);
    const instance = await getInstance(instanceName);

    let vmStatus: SandboxStatus['vmStatus'];
    switch (instance.status) {
      case 'Running':
        vmStatus = 'Running';
        break;
      case 'Stopped':
        vmStatus = 'Stopped';
        break;
      case 'NotFound':
        vmStatus = 'NotCreated';
        break;
      default:
        vmStatus = 'Stopped';
        break;
    }

    return { available: true, enabled, vmStatus, instanceName };
  });

  ipcMain.handle('lima:enable', async (_event, projectPath: string): Promise<{ success: boolean; error?: string }> => {
    const available = await isLimaInstalled();
    if (!available) {
      return { success: false, error: 'limactl is not installed' };
    }

    const settings = await loadSettings();
    settings[projectPath] = { ...settings[projectPath], enabled: true };
    await saveSettings(settings);

    return { success: true };
  });

  ipcMain.handle('lima:disable', async (_event, projectPath: string): Promise<{ success: boolean; error?: string }> => {
    const settings = await loadSettings();
    settings[projectPath] = { ...settings[projectPath], enabled: false };
    await saveSettings(settings);

    // Stop the VM but don't delete it (can re-enable later)
    const instanceName = getInstanceName(projectPath);
    const instance = await getInstance(instanceName);
    if (instance.status === 'Running') {
      await stopInstance(instanceName);
    }

    return { success: true };
  });
}

/**
 * Clean up: kill sandboxed PTYs and stop all running ouijit VMs.
 * Synchronous so it completes before the process exits.
 */
export function cleanup(): void {
  cleanupSandboxPtys();
  stopAllInstances();
}
