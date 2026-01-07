import { ipcMain, shell, BrowserWindow } from 'electron';
import { spawn } from 'node:child_process';
import { scanForProjects } from './scanner';
import {
  spawnPty,
  writeToPty,
  resizePty,
  killPty,
  cleanupAllPtys,
} from './ptyManager';
import type { RunConfig, LaunchResult, PtySpawnOptions } from './types';

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
  ipcMain.handle('pty:spawn', (_event, options: PtySpawnOptions) => {
    return spawnPty(options, mainWindow);
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
}

/**
 * Cleanup function to be called when app is quitting
 */
export function cleanupIpc(): void {
  cleanupAllPtys();
}
