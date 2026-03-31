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
import {
  ensureConfig,
  writeUserConfig,
  getMergedConfigForDisplay,
  validateYaml,
  deleteConfig,
} from '../../lima/configStore';

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

  typedHandle('lima:get-yaml', (projectPath) => ensureConfig(projectPath));

  typedHandle('lima:set-yaml', async (projectPath, yaml) => {
    const error = validateYaml(yaml);
    if (error) {
      return { success: false, error: `Invalid YAML: ${error}` };
    }
    await writeUserConfig(projectPath, yaml);
    return { success: true };
  });

  typedHandle('lima:get-merged-yaml', (projectPath) => getMergedConfigForDisplay(projectPath));

  typedHandle('lima:start', async (projectPath) => {
    const sendStep = (step: { id: string; label: string; status: 'active' | 'done' }) =>
      typedPush(mainWindow, 'lima:spawn-progress', step);
    const result = await ensureRunning(projectPath, sendStep);
    return { success: result.success, error: result.error };
  });

  typedHandle('lima:recreate', async (projectPath) => {
    const sendStep = (step: { id: string; label: string; status: 'active' | 'done' }) =>
      typedPush(mainWindow, 'lima:spawn-progress', step);
    return recreateInstance(projectPath, sendStep);
  });

  typedHandle('lima:delete', async (projectPath) => {
    const result = await deleteWithCleanup(projectPath);
    if (result.success) {
      await deleteConfig(projectPath);
    }
    return result;
  });
}
