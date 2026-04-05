import os from 'os';
import { shell, BrowserWindow, dialog } from 'electron';
import { typedHandle } from '../helpers';
import { getProjectList } from '../../scanner';
import { addProject, removeProject, reorderProjects, getProjectSettings, setKillExistingOnRun } from '../../db';
import { createProject } from '../../projectCreator';
import { openInEditor, openFileInEditor } from '../../editorLauncher';
import { deleteWithCleanup } from '../../lima/manager';
import { deleteConfig } from '../../lima/configStore';
import { getLogger } from '../../logger';

const ipcLog = getLogger().scope('ipc');

export function registerProjectHandlers(mainWindow: BrowserWindow): void {
  typedHandle('get-projects', () => getProjectList());
  typedHandle('get-home-path', () => os.homedir());
  typedHandle('refresh-projects', () => getProjectList());

  // Both open-project and open-in-finder use shell.openPath — they share the same
  // implementation because Finder/file-manager is the correct handler for directories.
  typedHandle('open-project', async (projectPath) => {
    await shell.openPath(projectPath);
    return { success: true };
  });

  typedHandle('open-in-finder', async (projectPath) => {
    await shell.openPath(projectPath);
    return { success: true };
  });

  typedHandle('open-in-editor', (projectPath, dirPath) => openInEditor(projectPath, dirPath));

  typedHandle('open-file-in-editor', (projectPath, workspaceRoot, filePath, line) =>
    openFileInEditor(projectPath, workspaceRoot, filePath, line),
  );

  typedHandle('open-external', (url) => {
    if (!/^https?:\/\//i.test(url)) {
      throw new Error('Only HTTP(S) URLs are allowed');
    }
    return shell.openExternal(url);
  });

  typedHandle('create-project', async (options) => {
    const result = await createProject(options);
    if (result.success && result.projectPath) {
      await addProject(result.projectPath);
    }
    return result;
  });

  typedHandle('show-folder-picker', async () => {
    try {
      const targetWindow = BrowserWindow.getFocusedWindow() ?? mainWindow;
      const result = await dialog.showOpenDialog(targetWindow, {
        properties: ['openDirectory'],
        title: 'Add Project Folder',
        buttonLabel: 'Add Project',
      });
      return { canceled: result.canceled, filePaths: result.filePaths };
    } catch (error) {
      ipcLog.error('folder picker failed', { error: error instanceof Error ? error.message : String(error) });
      return { canceled: true, filePaths: [] };
    }
  });

  typedHandle('add-project', (folderPath) => addProject(folderPath));
  typedHandle('remove-project', async (folderPath) => {
    // Clean up sandbox config and VM before removing from DB
    await deleteWithCleanup(folderPath).catch(() => {});
    await deleteConfig(folderPath).catch(() => {});
    return removeProject(folderPath);
  });
  typedHandle('reorder-projects', (paths) => reorderProjects(paths));
  typedHandle('get-project-settings', (projectPath) => getProjectSettings(projectPath));
  typedHandle('settings:set-kill-existing-on-run', (projectPath, kill) => setKillExistingOnRun(projectPath, kill));
}
