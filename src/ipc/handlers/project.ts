import { shell, BrowserWindow, dialog } from 'electron';
import { typedHandle } from '../helpers';
import { scanForProjects, getAddedProjects, addProject, removeProject } from '../../scanner';
import { getProjectSettings } from '../../projectSettings';
import { createProject } from '../../projectCreator';
import { openInEditor } from '../../editorLauncher';

export function registerProjectHandlers(mainWindow: BrowserWindow): void {
  typedHandle('get-projects', () => scanForProjects());
  typedHandle('refresh-projects', () => scanForProjects());

  typedHandle('open-project', async (projectPath) => {
    await shell.openPath(projectPath);
    return { success: true };
  });

  typedHandle('open-in-finder', async (projectPath) => {
    await shell.openPath(projectPath);
    return { success: true };
  });

  typedHandle('open-in-editor', (projectPath, dirPath) => openInEditor(projectPath, dirPath));

  typedHandle('open-external', (url) => shell.openExternal(url));

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
}
