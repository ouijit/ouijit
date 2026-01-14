import { ipcMain, shell, BrowserWindow, dialog } from 'electron';
import { spawn, execSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { scanForProjects } from './scanner';
import {
  spawnPty,
  writeToPty,
  resizePty,
  killPty,
  cleanupAllPtys,
} from './ptyManager';
import { exportProject, previewOuijitFile, importOuijitPackage } from './ouijit';
import { getGitStatus, getCompactGitStatus, getGitDropdownInfo, checkoutBranch, createBranch, getChangedFiles, getFileDiff } from './git';
import {
  getProjectSettings,
  saveCustomCommand,
  deleteCustomCommand,
  setDefaultCommand,
} from './projectSettings';
import type { RunConfig, LaunchResult, PtySpawnOptions, ExportResult, PreviewResult, ImportResult, CreateProjectOptions, CreateProjectResult, CustomCommand, ProjectSettings } from './types';
import type { GitStatus, CompactGitStatus, GitDropdownInfo, ChangedFile, FileDiff } from './git';

/**
 * Escapes a string for use in AppleScript
 */
function escapeAppleScript(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Launches a command in Terminal.app on macOS
 */
function launchInTerminal(projectPath: string, command: string): Promise<LaunchResult> {
  return new Promise((resolve) => {
    const escapedPath = escapeAppleScript(projectPath);
    const escapedCommand = escapeAppleScript(command);

    const script = `tell application "Terminal"
      do script "cd \\"${escapedPath}\\" && ${escapedCommand}"
      activate
    end tell`;

    const osascript = spawn('osascript', ['-e', script]);

    osascript.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true });
      } else {
        resolve({ success: false, error: `osascript exited with code ${code}` });
      }
    });

    osascript.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
  });
}

/**
 * Registers all IPC handlers for the main process
 */
export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  // Handler to get all detected projects
  ipcMain.handle('get-projects', async () => {
    try {
      const projects = await scanForProjects();
      return projects;
    } catch (error) {
      console.error('Error scanning for projects:', error);
      throw error;
    }
  });

  // Handler to open a project in the default file manager
  ipcMain.handle('open-project', async (_event, projectPath: string) => {
    try {
      await shell.openPath(projectPath);
      return { success: true };
    } catch (error) {
      console.error('Error opening project:', error);
      throw error;
    }
  });

  // Handler to open project in Finder explicitly
  ipcMain.handle('open-in-finder', async (_event, projectPath: string) => {
    try {
      await shell.openPath(projectPath);
      return { success: true };
    } catch (error) {
      console.error('Error opening in Finder:', error);
      throw error;
    }
  });

  // Handler to launch a project with a specific run config
  ipcMain.handle('launch-project', async (_event, projectPath: string, runConfig: RunConfig): Promise<LaunchResult> => {
    try {
      // Currently macOS only
      if (process.platform === 'darwin') {
        return await launchInTerminal(projectPath, runConfig.command);
      }

      // Fallback for other platforms - open in file manager
      await shell.openPath(projectPath);
      return { success: true };
    } catch (error) {
      console.error('Error launching project:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // PTY handlers
  ipcMain.handle('pty:spawn', async (_event, options: PtySpawnOptions) => {
    return await spawnPty(options, mainWindow);
  });

  ipcMain.on('pty:write', (_event, ptyId: string, data: string) => {
    writeToPty(ptyId, data);
  });

  ipcMain.on('pty:resize', (_event, ptyId: string, cols: number, rows: number) => {
    resizePty(ptyId, cols, rows);
  });

  ipcMain.on('pty:kill', (_event, ptyId: string) => {
    killPty(ptyId);
  });

  // Export project as .ouijit file
  ipcMain.handle('export-project', async (_event, projectPath: string): Promise<ExportResult> => {
    try {
      // Find project by path
      const projects = await scanForProjects();
      const project = projects.find(p => p.path === projectPath);

      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      // Show save dialog
      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Export Project',
        defaultPath: `${project.name}.ouijit`,
        filters: [{ name: 'Ouijit Package', extensions: ['ouijit'] }],
      });

      if (canceled || !filePath) {
        return { success: false, error: 'Cancelled' };
      }

      return exportProject({
        project,
        outputPath: filePath,
      });
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // Preview a .ouijit file before importing
  ipcMain.handle('preview-ouijit-file', async (_event, filePath: string): Promise<PreviewResult> => {
    return previewOuijitFile(filePath);
  });

  // Import a previewed .ouijit package
  ipcMain.handle('import-ouijit-package', async (_event, tempDir: string): Promise<ImportResult> => {
    return importOuijitPackage(tempDir);
  });

  // Open file dialog to select a .ouijit file
  ipcMain.handle('open-ouijit-file-dialog', async (): Promise<string | null> => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Import .ouijit file',
      filters: [{ name: 'Ouijit Package', extensions: ['ouijit'] }],
      properties: ['openFile'],
    });

    if (canceled || filePaths.length === 0) {
      return null;
    }

    return filePaths[0];
  });

  // Refresh projects (re-scan)
  ipcMain.handle('refresh-projects', async () => {
    try {
      const projects = await scanForProjects();
      return projects;
    } catch (error) {
      console.error('Error refreshing projects:', error);
      throw error;
    }
  });

  // Get git status for a project
  ipcMain.handle('get-git-status', async (_event, projectPath: string): Promise<GitStatus | null> => {
    return getGitStatus(projectPath);
  });

  // Get compact git status for at-a-glance display
  ipcMain.handle('get-compact-git-status', async (_event, projectPath: string): Promise<CompactGitStatus | null> => {
    return getCompactGitStatus(projectPath);
  });

  // Get extended git dropdown info for a project
  ipcMain.handle('get-git-dropdown-info', async (_event, projectPath: string): Promise<GitDropdownInfo | null> => {
    return getGitDropdownInfo(projectPath);
  });

  // Checkout a git branch
  ipcMain.handle('git-checkout', async (_event, projectPath: string, branchName: string) => {
    return checkoutBranch(projectPath, branchName);
  });

  // Create a new git branch
  ipcMain.handle('git-create-branch', async (_event, projectPath: string, branchName: string) => {
    return createBranch(projectPath, branchName);
  });

  // Get list of changed files
  ipcMain.handle('get-changed-files', async (_event, projectPath: string): Promise<ChangedFile[]> => {
    return getChangedFiles(projectPath);
  });

  // Get diff for a specific file
  ipcMain.handle('get-file-diff', async (_event, projectPath: string, filePath: string): Promise<FileDiff | null> => {
    return getFileDiff(projectPath, filePath);
  });

  // Create a new project
  ipcMain.handle('create-project', async (_event, options: CreateProjectOptions): Promise<CreateProjectResult> => {
    try {
      const projectsDir = path.join(os.homedir(), 'Ouijit', 'projects');
      const projectPath = path.join(projectsDir, options.name);

      // Check if project already exists
      try {
        await fs.access(projectPath);
        return { success: false, error: 'A project with this name already exists' };
      } catch {
        // Directory doesn't exist, which is what we want
      }

      // Ensure the projects directory exists
      await fs.mkdir(projectsDir, { recursive: true });

      // Create the project directory
      await fs.mkdir(projectPath);

      // Initialize git
      try {
        execSync('git init', { cwd: projectPath, stdio: 'ignore' });
      } catch (gitError) {
        console.warn('Failed to initialize git:', gitError);
        // Continue anyway - git init failing shouldn't block project creation
      }

      // Create CLAUDE.md
      const claudeMdContent = `# ${options.name}

## Project Overview

<!-- Describe your project here -->

## Development Guidelines

<!-- Add guidelines for Claude to follow -->
`;
      await fs.writeFile(path.join(projectPath, 'CLAUDE.md'), claudeMdContent, 'utf-8');

      return { success: true, projectPath };
    } catch (error) {
      console.error('Error creating project:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  });

  // Get project settings (custom commands, default command)
  ipcMain.handle('get-project-settings', async (_event, projectPath: string): Promise<ProjectSettings> => {
    return getProjectSettings(projectPath);
  });

  // Save a custom command for a project
  ipcMain.handle('save-custom-command', async (_event, projectPath: string, command: CustomCommand) => {
    return saveCustomCommand(projectPath, command);
  });

  // Delete a custom command
  ipcMain.handle('delete-custom-command', async (_event, projectPath: string, commandId: string) => {
    return deleteCustomCommand(projectPath, commandId);
  });

  // Set the default command for a project
  ipcMain.handle('set-default-command', async (_event, projectPath: string, commandId: string | null) => {
    return setDefaultCommand(projectPath, commandId);
  });
}

/**
 * Cleanup function to be called when app is quitting
 */
export function cleanupIpc(): void {
  cleanupAllPtys();
}
