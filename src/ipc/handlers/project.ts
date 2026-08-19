import os from 'os';
import { shell, BrowserWindow, dialog } from 'electron';
import { typedHandle } from '../helpers';
import { getProjectList } from '../../projectList';
import { removeProject, reorderProjects, setProjectIconColor } from '../../db';
import { initGitRepo } from '../../projectCreator';
import { getDefaultProjectsDir, prepareProjectsFolderChange, applyProjectsFolderChange } from '../../projectsFolder';
import { addExistingProject, createAndRegisterProject } from '../../services/projectRegistration';
import { seedOnboardingTaskIfFirstProject } from '../../onboarding';
import { openFileInEditor } from '../../editorLauncher';
import { deleteWithCleanup } from '../../lima/manager';
import { deleteConfig } from '../../lima/configStore';
import { getActiveSessions } from '../../ptyManager';
import { getLogger } from '../../logger';

const ipcLog = getLogger().scope('ipc');

/** Projects with running terminal sessions; they refuse to be moved on disk. */
function activeProjectPaths(): Set<string> {
  return new Set(getActiveSessions().map((session) => session.projectPath));
}

/**
 * Hands a directory to the OS file manager (Finder, Explorer, the Linux
 * desktop's handler). shell.openPath resolves to a non-empty string when the
 * open fails — a deleted worktree is the common case — so the renderer can
 * surface it instead of the click doing nothing.
 */
async function revealPath(targetPath: string): Promise<{ success: boolean; error?: string }> {
  const error = await shell.openPath(targetPath);
  if (error) {
    ipcLog.warn('open path failed', { targetPath, error });
    return { success: false, error };
  }
  return { success: true };
}

/** Unregister a project, cleaning up its sandbox VM and config first. */
async function removeProjectWithCleanup(folderPath: string): Promise<void> {
  await deleteWithCleanup(folderPath).catch(() => {});
  await deleteConfig(folderPath).catch(() => {});
  await removeProject(folderPath);
}

export function registerProjectHandlers(mainWindow: BrowserWindow): void {
  typedHandle('get-projects', () => getProjectList());
  typedHandle('get-home-path', () => os.homedir());
  typedHandle('refresh-projects', () => getProjectList());

  // Both open-project and open-in-finder use shell.openPath — they share the same
  // implementation because Finder/file-manager is the correct handler for directories.
  typedHandle('open-project', (projectPath) => revealPath(projectPath));
  typedHandle('open-in-finder', (projectPath) => revealPath(projectPath));

  typedHandle('open-file-in-editor', (projectPath, workspaceRoot, filePath, line) =>
    openFileInEditor(projectPath, workspaceRoot, filePath, line),
  );

  typedHandle('open-external', (url) => {
    if (!/^https?:\/\//i.test(url)) {
      throw new Error('Only HTTP(S) URLs are allowed');
    }
    return shell.openExternal(url);
  });

  typedHandle('create-project', (options) => createAndRegisterProject(options));

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
  typedHandle('projects:prepare-folder-change', (newFolder) =>
    prepareProjectsFolderChange(newFolder, activeProjectPaths()),
  );
  typedHandle('projects:apply-folder-change', (newFolder, action) =>
    applyProjectsFolderChange(newFolder, action, {
      activeProjectPaths: activeProjectPaths(),
      removeProject: removeProjectWithCleanup,
    }),
  );

  typedHandle('add-project', (folderPath) => addExistingProject(folderPath));
  typedHandle('init-git-repo', (folderPath, initialCommit) => initGitRepo(folderPath, { initialCommit }));
  typedHandle('remove-project', async (folderPath) => {
    await removeProjectWithCleanup(folderPath);
    return { success: true };
  });
  typedHandle('onboarding:seed-task', async (projectPath) => {
    await seedOnboardingTaskIfFirstProject(projectPath);
    return { success: true };
  });
  typedHandle('reorder-projects', (paths) => reorderProjects(paths));
  typedHandle('settings:set-project-icon-color', (projectPath, color) => setProjectIconColor(projectPath, color));
}
