// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { Project, PtySpawnOptions, PtySpawnResult, PtyId, ActiveSession, PtyReconnectResult, CreateProjectOptions, CreateProjectResult, GitStatus, CompactGitStatus, GitDropdownInfo, GitCheckoutResult, GitMergeResult, ChangedFile, FileDiff, ProjectSettings, WorktreeCreateResult, WorktreeRemoveResult, WorktreeInfo, WorktreeDiffSummary, WorktreeWithMetadata, ScriptHook, HookType, BranchInfo } from './types';

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

    getDiff: (projectPath: string, worktreeBranch: string, targetBranch?: string): Promise<WorktreeDiffSummary | null> =>
      ipcRenderer.invoke('worktree:get-diff', projectPath, worktreeBranch, targetBranch),

    getFileDiff: (projectPath: string, worktreeBranch: string, filePath: string, targetBranch?: string): Promise<FileDiff | null> =>
      ipcRenderer.invoke('worktree:get-file-diff', projectPath, worktreeBranch, filePath, targetBranch),

    merge: (projectPath: string, worktreeBranch: string): Promise<GitMergeResult> =>
      ipcRenderer.invoke('worktree:merge', projectPath, worktreeBranch),

    ship: (projectPath: string, worktreeBranch: string, commitMessage?: string): Promise<{ success: boolean; error?: string; conflictFiles?: string[]; mergedBranch?: string }> =>
      ipcRenderer.invoke('worktree:ship', projectPath, worktreeBranch, commitMessage),

    getTasks: (projectPath: string): Promise<WorktreeWithMetadata[]> =>
      ipcRenderer.invoke('worktree:get-tasks', projectPath),

    close: (projectPath: string, branch: string): Promise<{ success: boolean; error?: string; hookWarning?: string }> =>
      ipcRenderer.invoke('worktree:close', projectPath, branch),

    reopen: (projectPath: string, branch: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('worktree:reopen', projectPath, branch),

    setReady: (projectPath: string, branch: string, ready: boolean): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('worktree:set-ready', projectPath, branch, ready),

    listBranches: (projectPath: string): Promise<BranchInfo[]> =>
      ipcRenderer.invoke('worktree:list-branches', projectPath),

    setMergeTarget: (projectPath: string, branch: string, mergeTarget: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('worktree:set-merge-target', projectPath, branch, mergeTarget),

    getMainBranch: (projectPath: string): Promise<string> =>
      ipcRenderer.invoke('worktree:get-main-branch', projectPath),
  },

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
   * Show native folder picker dialog
   */
  showFolderPicker: (): Promise<{ canceled: boolean; filePaths: string[] }> =>
    ipcRenderer.invoke('show-folder-picker'),

  /**
   * Add a project folder to the app
   */
  addProject: (folderPath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('add-project', folderPath),

  /**
   * Remove a project folder from the app
   */
  removeProject: (folderPath: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('remove-project', folderPath),

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
   * Set whether to kill existing command instances on run
   */
  setKillExistingOnRun: (projectPath: string, kill: boolean): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('settings:set-kill-existing-on-run', projectPath, kill),

  /**
   * Script hooks API
   */
  hooks: {
    /**
     * Get all hooks for a project
     */
    get: (projectPath: string): Promise<{ init?: ScriptHook; run?: ScriptHook; cleanup?: ScriptHook }> =>
      ipcRenderer.invoke('hooks:get', projectPath),

    /**
     * Save a hook for a project
     */
    save: (projectPath: string, hook: ScriptHook): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('hooks:save', projectPath, hook),

    /**
     * Delete a hook for a project
     */
    delete: (projectPath: string, hookType: HookType): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('hooks:delete', projectPath, hookType),
  },

  /**
   * Get file path from a dropped File object
   */
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
});
