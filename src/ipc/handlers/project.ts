import os from 'os';
import path from 'node:path';
import { shell, BrowserWindow, dialog } from 'electron';
import { typedHandle } from '../helpers';
import { getProjectList } from '../../scanner';
import { addProject, removeProject, reorderProjects, getProjectSettings, setKillExistingOnRun } from '../../db';
import { createProject, validateProjectFolder, initGitRepo } from '../../projectCreator';
import { getDefaultProjectsDir, setDefaultProjectsDir, scanSiblingProjects, moveProjects } from '../../projectsFolder';
import { recordFirstProjectIfNeeded, seedOnboardingTaskIfFirstProject } from '../../onboarding';
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
      try {
        await addProject(result.projectPath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ipcLog.error('failed to persist created project', { error: message });
        return {
          success: false,
          error: `Project folder created at ${result.projectPath}, but registering it failed: ${message}`,
        };
      }
      // The folder this project was created in becomes the default for the next one.
      await setDefaultProjectsDir(path.dirname(result.projectPath));
      await recordFirstProjectIfNeeded(result.projectPath, 'created');
    }
    return result;
  });

  typedHandle('show-folder-picker', async (options) => {
    try {
      const targetWindow = BrowserWindow.getFocusedWindow() ?? mainWindow;
      const result = await dialog.showOpenDialog(targetWindow, {
        properties: ['openDirectory', 'createDirectory'],
        title: options?.title ?? 'Add Project Folder',
        buttonLabel: options?.buttonLabel ?? 'Add Project',
        ...(options?.defaultPath ? { defaultPath: options.defaultPath } : {}),
      });
      return { canceled: result.canceled, filePaths: result.filePaths };
    } catch (error) {
      ipcLog.error('folder picker failed', { error: error instanceof Error ? error.message : String(error) });
      return { canceled: true, filePaths: [] };
    }
  });

  typedHandle('projects:get-default-folder', () => getDefaultProjectsDir());
  typedHandle('projects:scan-siblings', (folderPath) => scanSiblingProjects(folderPath));
  typedHandle('projects:relocate', (projectPaths, newFolder) => moveProjects(projectPaths, newFolder));

  typedHandle('add-project', async (folderPath) => {
    const validation = await validateProjectFolder(folderPath);
    if (validation.ok === false) return { success: false, error: validation.error, reason: validation.reason };
    try {
      await addProject(folderPath);
      await recordFirstProjectIfNeeded(folderPath, 'added');
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
  typedHandle('init-git-repo', (folderPath, initialCommit) => initGitRepo(folderPath, { initialCommit }));
  typedHandle('remove-project', async (folderPath) => {
    // Clean up sandbox config and VM before removing from DB
    await deleteWithCleanup(folderPath).catch(() => {});
    await deleteConfig(folderPath).catch(() => {});
    return removeProject(folderPath);
  });
  typedHandle('onboarding:seed-task', async (projectPath) => {
    await seedOnboardingTaskIfFirstProject(projectPath);
    return { success: true };
  });
  typedHandle('reorder-projects', (paths) => reorderProjects(paths));
  typedHandle('get-project-settings', (projectPath) => getProjectSettings(projectPath));
  typedHandle('settings:set-kill-existing-on-run', (projectPath, kill) => setKillExistingOnRun(projectPath, kill));
}
