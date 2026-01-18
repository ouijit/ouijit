// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { Project, RunConfig, LaunchResult, PtySpawnOptions, PtySpawnResult, PtyId, ActiveSession, PtyReconnectResult, ExportResult, PreviewResult, ImportResult, CreateProjectOptions, CreateProjectResult, GitStatus, CompactGitStatus, GitDropdownInfo, GitCheckoutResult, GitMergeResult, ChangedFile, FileDiff, ProjectSettings, CustomCommand, WorktreeCreateResult, WorktreeRemoveResult, WorktreeInfo, WorktreeDiffSummary, WorktreeWithMetadata } from './types';

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

    // Get active PTY sessions for reconnection after reload
    getActiveSessions: (): Promise<ActiveSession[]> =>
      ipcRenderer.invoke('pty:get-active-sessions'),

    // Reconnect to an existing PTY after renderer reload
    reconnect: (ptyId: PtyId): Promise<PtyReconnectResult> =>
      ipcRenderer.invoke('pty:reconnect', ptyId),

    // Update window reference after reconnection
    setWindow: (): void => {
      ipcRenderer.send('pty:set-window');
    },
  },

  /**
   * Worktree management API
   */
  worktree: {
    create: (projectPath: string, name?: string): Promise<WorktreeCreateResult> =>
      ipcRenderer.invoke('worktree:create', projectPath, name),

    remove: (projectPath: string, worktreePath: string): Promise<WorktreeRemoveResult> =>
      ipcRenderer.invoke('worktree:remove', projectPath, worktreePath),

    list: (projectPath: string): Promise<WorktreeInfo[]> =>
      ipcRenderer.invoke('worktree:list', projectPath),

    getDiff: (projectPath: string, worktreeBranch: string): Promise<WorktreeDiffSummary | null> =>
      ipcRenderer.invoke('worktree:get-diff', projectPath, worktreeBranch),

    getFileDiff: (projectPath: string, worktreeBranch: string, filePath: string): Promise<FileDiff | null> =>
      ipcRenderer.invoke('worktree:get-file-diff', projectPath, worktreeBranch, filePath),

    merge: (projectPath: string, worktreeBranch: string): Promise<GitMergeResult> =>
      ipcRenderer.invoke('worktree:merge', projectPath, worktreeBranch),

    getTasks: (projectPath: string): Promise<WorktreeWithMetadata[]> =>
      ipcRenderer.invoke('worktree:get-tasks', projectPath),

    close: (projectPath: string, branch: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('worktree:close', projectPath, branch),

    reopen: (projectPath: string, branch: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('worktree:reopen', projectPath, branch),
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
   * Get compact git status for at-a-glance display
   */
  getCompactGitStatus: (projectPath: string): Promise<CompactGitStatus | null> =>
    ipcRenderer.invoke('get-compact-git-status', projectPath),

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
   * Create a new git branch
   */
  gitCreateBranch: (projectPath: string, branchName: string): Promise<GitCheckoutResult> =>
    ipcRenderer.invoke('git-create-branch', projectPath, branchName),

  /**
   * Merge current branch into main
   */
  gitMergeIntoMain: (projectPath: string): Promise<GitMergeResult> =>
    ipcRenderer.invoke('git-merge-into-main', projectPath),

  /**
   * Get list of changed files
   */
  getChangedFiles: (projectPath: string): Promise<ChangedFile[]> =>
    ipcRenderer.invoke('get-changed-files', projectPath),

  /**
   * Get diff for a specific file
   */
  getFileDiff: (projectPath: string, filePath: string): Promise<FileDiff | null> =>
    ipcRenderer.invoke('get-file-diff', projectPath, filePath),

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

  /**
   * Get project settings (custom commands, default command)
   */
  getProjectSettings: (projectPath: string): Promise<ProjectSettings> =>
    ipcRenderer.invoke('get-project-settings', projectPath),

  /**
   * Save a custom command for a project
   */
  saveCustomCommand: (projectPath: string, command: CustomCommand): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('save-custom-command', projectPath, command),

  /**
   * Delete a custom command
   */
  deleteCustomCommand: (projectPath: string, commandId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('delete-custom-command', projectPath, commandId),

  /**
   * Set the default command for a project
   */
  setDefaultCommand: (projectPath: string, commandId: string | null): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('set-default-command', projectPath, commandId),
});

// Expose Electron utilities
contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Get the file system path for a File object from drag & drop
   */
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
});
