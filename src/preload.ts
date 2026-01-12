// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { Project, RunConfig, LaunchResult, PtySpawnOptions, PtySpawnResult, PtyId, ExportResult, PreviewResult, ImportResult, CreateProjectOptions, CreateProjectResult, GitStatus, GitDropdownInfo, GitCheckoutResult } from './types';

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

  /**
   * Export a project as .ouijit file
   */
  exportProject: (projectPath: string): Promise<ExportResult> =>
    ipcRenderer.invoke('export-project', projectPath),

  /**
   * Preview a .ouijit file before importing
   */
  previewOuijitFile: (filePath: string): Promise<PreviewResult> =>
    ipcRenderer.invoke('preview-ouijit-file', filePath),

  /**
   * Import a previewed .ouijit package
   */
  importOuijitPackage: (tempDir: string): Promise<ImportResult> =>
    ipcRenderer.invoke('import-ouijit-package', tempDir),

  /**
   * Open file dialog to select a .ouijit file
   */
  openOuijitFileDialog: (): Promise<string | null> =>
    ipcRenderer.invoke('open-ouijit-file-dialog'),

  /**
   * Refresh the project list
   */
  refreshProjects: (): Promise<Project[]> =>
    ipcRenderer.invoke('refresh-projects'),

  /**
   * Get git status (branch and dirty state) for a project
   */
  getGitStatus: (projectPath: string): Promise<GitStatus | null> =>
    ipcRenderer.invoke('get-git-status', projectPath),

  /**
   * Get extended git dropdown info for a project
   */
  getGitDropdownInfo: (projectPath: string): Promise<GitDropdownInfo | null> =>
    ipcRenderer.invoke('get-git-dropdown-info', projectPath),

  /**
   * Checkout a git branch
   */
  gitCheckout: (projectPath: string, branchName: string): Promise<GitCheckoutResult> =>
    ipcRenderer.invoke('git-checkout', projectPath, branchName),

  /**
   * Create a new project
   */
  createProject: (options: CreateProjectOptions): Promise<CreateProjectResult> =>
    ipcRenderer.invoke('create-project', options),

  /**
   * Listen for fullscreen state changes
   */
  onFullscreenChange: (callback: (isFullscreen: boolean) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, isFullscreen: boolean) => callback(isFullscreen);
    ipcRenderer.on('fullscreen-change', handler);
    return () => ipcRenderer.removeListener('fullscreen-change', handler);
  },
});

// Expose Electron utilities
contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Get the file system path for a File object from drag & drop
   */
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
});
