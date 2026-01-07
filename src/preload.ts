// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from 'electron';
import type { Project, RunConfig, LaunchResult, PtySpawnOptions, PtySpawnResult, PtyId } from './types';

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('api', {
  /**
   * Scans for projects in predefined directories
   */
  getProjects: (): Promise<Project[]> => ipcRenderer.invoke('get-projects'),

  /**
   * Opens a project directory in the default file manager
   */
  openProject: (path: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('open-project', path),

  /**
   * Launch a project with a specific run configuration
   */
  launchProject: (projectPath: string, runConfig: RunConfig): Promise<LaunchResult> =>
    ipcRenderer.invoke('launch-project', projectPath, runConfig),

  /**
   * Open project in Finder
   */
  openInFinder: (path: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('open-in-finder', path),

  /**
   * PTY management API
   */
  pty: {
    spawn: (options: PtySpawnOptions): Promise<PtySpawnResult> =>
      ipcRenderer.invoke('pty:spawn', options),

    write: (ptyId: PtyId, data: string): void => {
      ipcRenderer.send('pty:write', ptyId, data);
    },

    resize: (ptyId: PtyId, cols: number, rows: number): void => {
      ipcRenderer.send('pty:resize', ptyId, cols, rows);
    },

    kill: (ptyId: PtyId): void => {
      ipcRenderer.send('pty:kill', ptyId);
    },

    onData: (ptyId: PtyId, callback: (data: string) => void): (() => void) => {
      const channel = `pty:data:${ptyId}`;
      const handler = (_event: Electron.IpcRendererEvent, data: string) => callback(data);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    },

    onExit: (ptyId: PtyId, callback: (exitCode: number) => void): (() => void) => {
      const channel = `pty:exit:${ptyId}`;
      const handler = (_event: Electron.IpcRendererEvent, exitCode: number) => callback(exitCode);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    },
  },
});
