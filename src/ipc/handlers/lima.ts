import { BrowserWindow } from 'electron';
import { typedHandle } from '../helpers';
import type { SandboxStatus } from '../../lima/types';
import {
  isLimaInstalled,
  getInstance,
  getInstanceName,
  stopInstance,
  deleteInstance,
  startInstance,
  createInstance,
  ensureRunning,
} from '../../lima/manager';
import { resetSetupTracking } from '../../lima/spawn';
import { getSandboxConfig, setSandboxConfig } from '../../projectSettings';

export function registerLimaHandlers(mainWindow: BrowserWindow): void {
  typedHandle('lima:status', async (projectPath): Promise<SandboxStatus> => {
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
      case 'Broken':
        vmStatus = 'Broken';
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

  typedHandle('lima:stop', async (projectPath) => {
    const instanceName = getInstanceName(projectPath);
    const instance = await getInstance(instanceName);
    if (instance.status === 'Running') {
      return stopInstance(instanceName);
    }
    return { success: true };
  });

  typedHandle('lima:get-config', (projectPath) => getSandboxConfig(projectPath));

  typedHandle('lima:set-config', (projectPath, config) => setSandboxConfig(projectPath, config));

  typedHandle('lima:start', async (projectPath) => {
    const sandboxConfig = await getSandboxConfig(projectPath);
    const sendProgress = (msg: string) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('lima:spawn-progress', msg);
      }
    };
    const result = await ensureRunning(projectPath, { memoryGiB: sandboxConfig.memoryGiB, diskGiB: sandboxConfig.diskGiB }, sendProgress);
    return { success: result.success, error: result.error };
  });

  typedHandle('lima:recreate', async (projectPath) => {
    const instanceName = getInstanceName(projectPath);
    const sendProgress = (msg: string) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('lima:spawn-progress', msg);
      }
    };

    try {
      const instance = await getInstance(instanceName);
      if (instance.status === 'Running') {
        sendProgress('Stopping VM…');
        const stopResult = await stopInstance(instanceName);
        if (!stopResult.success) {
          return { success: false, error: stopResult.error };
        }
      }

      if (instance.status !== 'NotFound') {
        sendProgress('Deleting VM…');
        const deleteResult = await deleteInstance(instanceName);
        if (!deleteResult.success) {
          return { success: false, error: deleteResult.error };
        }
      }

      const config = await getSandboxConfig(projectPath);
      sendProgress('Creating sandbox VM (this may take a few minutes)…');
      const createResult = await createInstance(projectPath, { memoryGiB: config.memoryGiB, diskGiB: config.diskGiB });
      if (!createResult.success) {
        return { success: false, error: createResult.error };
      }

      sendProgress('Starting sandbox VM…');
      const startResult = await startInstance(instanceName, sendProgress);
      if (!startResult.success) {
        return { success: false, error: startResult.error };
      }

      resetSetupTracking(instanceName);
      sendProgress('VM recreated successfully');
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: msg };
    }
  });

  typedHandle('lima:delete', async (projectPath) => {
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
