import { BrowserWindow, dialog, shell } from 'electron';
import { typedHandle } from '../helpers';
import { listSandboxProviders } from '../../sandbox';
import { getNonoProfile, setNonoProfile } from '../../sandbox/nono/config';
import { nonoProfilesDir } from '../../sandbox/nono/profile';
import { getCustomSandboxConfig, setCustomSandboxConfig } from '../../sandbox/custom/config';

/**
 * Cross-provider sandbox IPC. Reports availability for every
 * registered backend so the renderer can feature-detect (which backends to
 * offer, whether a chosen backend can spawn right now), plus each
 * backend's own config surface.
 */
export function registerSandboxHandlers(): void {
  typedHandle('sandbox:status', (projectPath) =>
    Promise.all(listSandboxProviders().map((p) => p.getStatus(projectPath))),
  );

  typedHandle('sandbox:nono-profile', (projectPath) => getNonoProfile(projectPath));
  typedHandle('sandbox:choose-nono-profile', async (projectPath) => {
    const window = BrowserWindow.getFocusedWindow();
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile', 'showHiddenFiles'],
      filters: [{ name: 'nono profile', extensions: ['json'] }],
      defaultPath: nonoProfilesDir(),
      title: 'Choose a sandbox profile',
      buttonLabel: 'Use',
    };
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    const [file] = result.filePaths;
    if (result.canceled || !file) return null;
    return setNonoProfile(projectPath, file);
  });
  typedHandle('sandbox:reset-nono-profile', (projectPath) => setNonoProfile(projectPath, null));
  typedHandle('sandbox:open-nono-profile', async (projectPath) => {
    const error = await shell.openPath((await getNonoProfile(projectPath)).path);
    return error ? { success: false, error } : { success: true };
  });
  typedHandle('sandbox:custom-config', (projectPath) => getCustomSandboxConfig(projectPath));
  typedHandle('sandbox:set-custom-config', (projectPath, config) => setCustomSandboxConfig(projectPath, config));
}
