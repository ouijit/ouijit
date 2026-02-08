import { ipcMain, BrowserWindow } from 'electron';
import type { SandboxStatus } from './types';
import { isLimaInstalled, getInstance, getInstanceName, stopInstance, stopAllInstances } from './manager';
import { spawnSandboxedPty, cleanupSandboxPtys } from './spawn';

export { spawnSandboxedPty, isSandboxPty, writeSandboxPty, resizeSandboxPty, killSandboxPty } from './spawn';

/**
 * Register Lima-specific IPC handlers
 */
export function registerLimaHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle('lima:status', async (_event, projectPath: string): Promise<SandboxStatus> => {
    const available = await isLimaInstalled();
    if (!available) {
      return { available: false, vmStatus: 'Unavailable' };
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

    return { available: true, vmStatus, instanceName };
  });

  ipcMain.handle('lima:stop', async (_event, projectPath: string): Promise<{ success: boolean; error?: string }> => {
    const instanceName = getInstanceName(projectPath);
    const instance = await getInstance(instanceName);
    if (instance.status === 'Running') {
      return stopInstance(instanceName);
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
