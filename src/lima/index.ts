import { ipcMain, BrowserWindow } from 'electron';
import type { SandboxStatus } from './types';
import { isLimaInstalled, getInstance, getInstanceName, stopInstance, deleteInstance, startInstance, createInstance, stopAllInstances, ensureRunning } from './manager';
import { spawnSandboxedPty, cleanupSandboxPtys } from './spawn';
import { getSandboxConfig, setSandboxConfig } from '../projectSettings';

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

    return {
      available: true,
      vmStatus,
      instanceName,
      ...(vmStatus !== 'NotCreated' && { memory: instance.memory, disk: instance.disk }),
    };
  });

  ipcMain.handle('lima:stop', async (_event, projectPath: string): Promise<{ success: boolean; error?: string }> => {
    const instanceName = getInstanceName(projectPath);
    const instance = await getInstance(instanceName);
    if (instance.status === 'Running') {
      return stopInstance(instanceName);
    }
    return { success: true };
  });

  ipcMain.handle('lima:get-config', async (_event, projectPath: string): Promise<{ memoryGiB: number; diskGiB: number }> => {
    return getSandboxConfig(projectPath);
  });

  ipcMain.handle('lima:set-config', async (_event, projectPath: string, config: { memoryGiB?: number; diskGiB?: number }): Promise<{ success: boolean }> => {
    return setSandboxConfig(projectPath, config);
  });

  ipcMain.handle('lima:start', async (_event, projectPath: string): Promise<{ success: boolean; error?: string }> => {
    const sandboxConfig = await getSandboxConfig(projectPath);
    const sendProgress = (msg: string) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('lima:spawn-progress', msg);
      }
    };
    const result = await ensureRunning(projectPath, { memoryGiB: sandboxConfig.memoryGiB, diskGiB: sandboxConfig.diskGiB }, sendProgress);
    return { success: result.success, error: result.error };
  });

  ipcMain.handle('lima:recreate', async (_event, projectPath: string): Promise<{ success: boolean; error?: string }> => {
    const instanceName = getInstanceName(projectPath);
    const sendProgress = (msg: string) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('lima:spawn-progress', msg);
      }
    };

    try {
      // Stop if running
      const instance = await getInstance(instanceName);
      if (instance.status === 'Running') {
        sendProgress('Stopping VM…');
        const stopResult = await stopInstance(instanceName);
        if (!stopResult.success) {
          return { success: false, error: stopResult.error };
        }
      }

      // Delete if exists
      if (instance.status !== 'NotFound') {
        sendProgress('Deleting VM…');
        const deleteResult = await deleteInstance(instanceName);
        if (!deleteResult.success) {
          return { success: false, error: deleteResult.error };
        }
      }

      // Create with current project settings
      const config = await getSandboxConfig(projectPath);
      sendProgress('Creating sandbox VM (this may take a few minutes)…');
      const createResult = await createInstance(projectPath, { memoryGiB: config.memoryGiB, diskGiB: config.diskGiB });
      if (!createResult.success) {
        return { success: false, error: createResult.error };
      }

      // Start
      sendProgress('Starting sandbox VM…');
      const startResult = await startInstance(instanceName, sendProgress);
      if (!startResult.success) {
        return { success: false, error: startResult.error };
      }

      sendProgress('VM recreated successfully');
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('lima:delete', async (_event, projectPath: string): Promise<{ success: boolean; error?: string }> => {
    const instanceName = getInstanceName(projectPath);
    try {
      const instance = await getInstance(instanceName);
      if (instance.status === 'Running') {
        const stopResult = await stopInstance(instanceName);
        if (!stopResult.success) {
          return { success: false, error: stopResult.error };
        }
      }
      if (instance.status !== 'NotFound') {
        return deleteInstance(instanceName);
      }
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: msg };
    }
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
