import { BrowserWindow } from 'electron';
import { typedHandle, typedPush } from '../helpers';
import {
  getLimaStatus,
  getInstanceName,
  getInstance,
  stopInstance,
  ensureRunning,
  recreateInstance,
  deleteWithCleanup,
} from '../../lima/manager';
import { getSandboxConfig, setSandboxConfig } from '../../db';

export function registerLimaHandlers(mainWindow: BrowserWindow): void {
  typedHandle('lima:status', (projectPath) => getLimaStatus(projectPath));

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
    const sendProgress = (msg: string) => typedPush(mainWindow, 'lima:spawn-progress', msg);
    const result = await ensureRunning(projectPath, { memoryGiB: sandboxConfig.memoryGiB, diskGiB: sandboxConfig.diskGiB }, sendProgress);
    return { success: result.success, error: result.error };
  });

  typedHandle('lima:recreate', async (projectPath) => {
    const config = await getSandboxConfig(projectPath);
    const sendProgress = (msg: string) => typedPush(mainWindow, 'lima:spawn-progress', msg);
    return recreateInstance(projectPath, { memoryGiB: config.memoryGiB, diskGiB: config.diskGiB }, sendProgress);
  });

  typedHandle('lima:delete', (projectPath) => deleteWithCleanup(projectPath));
}
