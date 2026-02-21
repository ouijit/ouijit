import { shell, BrowserWindow, dialog } from 'electron';
import { typedHandle } from '../helpers';
import { scanForProjects } from '../../scanner';
import { getAddedProjects, addProject, removeProject, getProjectSettings, setKillExistingOnRun } from '../../db';
import { createProject } from '../../projectCreator';
import { openInEditor } from '../../editorLauncher';

export function registerProjectHandlers(mainWindow: BrowserWindow): void {
  typedHandle('get-projects', () => scanForProjects());
  typedHandle('refresh-projects', () => scanForProjects());

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

  typedHandle('open-external', (url) => {
    if (!/^https?:\/\//i.test(url)) {
      throw new Error('Only HTTP(S) URLs are allowed');
    }
    return shell.openExternal(url);
  });

  typedHandle('create-project', (options) => createProject(options));

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
      console.error('Error showing folder picker:', error);
      return { canceled: true, filePaths: [] };
    }
  });

  typedHandle('add-project', (folderPath) => addProject(folderPath));
  typedHandle('remove-project', (folderPath) => removeProject(folderPath));
  typedHandle('get-added-projects', () => getAddedProjects());
  typedHandle('get-project-settings', (projectPath) => getProjectSettings(projectPath));
  typedHandle('settings:set-kill-existing-on-run', (projectPath, kill) => setKillExistingOnRun(projectPath, kill));
}
