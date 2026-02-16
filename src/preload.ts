// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer, webFrame, webUtils } from 'electron';

// Set default zoom level to one step up (~120%)
webFrame.setZoomLevel(1);
import type { Project, PtySpawnOptions, PtySpawnResult, PtyId, ActiveSession, PtyReconnectResult, CreateProjectOptions, CreateProjectResult, GitStatus, CompactGitStatus, GitDropdownInfo, GitCheckoutResult, GitMergeResult, ChangedFile, FileDiff, ProjectSettings, TaskCreateResult, WorktreeRemoveResult, WorktreeInfo, WorktreeDiffSummary, TaskWithWorkspace, TaskStatus, ScriptHook, HookType, BranchInfo } from './types';

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
   * Worktree management API (git plumbing only — task ops are on task namespace)
   */
  worktree: {
    validateBranchName: (projectPath: string, branchName: string): Promise<{ valid: boolean; error?: string }> =>
      ipcRenderer.invoke('worktree:validate-branch-name', projectPath, branchName),

    generateBranchName: (projectPath: string, name: string): Promise<string> =>
      ipcRenderer.invoke('worktree:generate-branch-name', projectPath, name),

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

    listBranches: (projectPath: string): Promise<BranchInfo[]> =>
      ipcRenderer.invoke('worktree:list-branches', projectPath),

    getMainBranch: (projectPath: string): Promise<string> =>
      ipcRenderer.invoke('worktree:get-main-branch', projectPath),
  },

  task: {
    create: (projectPath: string, name?: string, prompt?: string): Promise<TaskCreateResult> =>
      ipcRenderer.invoke('task:create', projectPath, name, prompt),

    createAndStart: (projectPath: string, name?: string, prompt?: string, branchName?: string): Promise<TaskCreateResult> =>
      ipcRenderer.invoke('task:create-and-start', projectPath, name, prompt, branchName),

    start: (projectPath: string, taskNumber: number, branchName?: string): Promise<TaskCreateResult> =>
      ipcRenderer.invoke('task:start', projectPath, taskNumber, branchName),

    getAll: (projectPath: string): Promise<TaskWithWorkspace[]> =>
      ipcRenderer.invoke('task:get-all', projectPath),

    getByNumber: (projectPath: string, taskNumber: number): Promise<TaskWithWorkspace | null> =>
      ipcRenderer.invoke('task:get-by-number', projectPath, taskNumber),

    setStatus: (projectPath: string, taskNumber: number, status: TaskStatus): Promise<{ success: boolean; error?: string; hookWarning?: string }> =>
      ipcRenderer.invoke('task:set-status', projectPath, taskNumber, status),

    delete: (projectPath: string, taskNumber: number): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('task:delete', projectPath, taskNumber),

    setMergeTarget: (projectPath: string, taskNumber: number, mergeTarget: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('task:set-merge-target', projectPath, taskNumber, mergeTarget),

    setSandboxed: (projectPath: string, taskNumber: number, sandboxed: boolean): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('task:set-sandboxed', projectPath, taskNumber, sandboxed),

    setName: (projectPath: string, taskNumber: number, name: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('task:set-name', projectPath, taskNumber, name),

    setDescription: (projectPath: string, taskNumber: number, description: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('task:set-description', projectPath, taskNumber, description),
  },

  /**
   * Open a directory in the user's configured code editor
   */
  openInEditor: (projectPath: string, dirPath: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('open-in-editor', projectPath, dirPath),

  /**
   * Open a URL in the default browser
   */
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke('open-external', url),

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
    get: (projectPath: string): Promise<{ start?: ScriptHook; continue?: ScriptHook; run?: ScriptHook; cleanup?: ScriptHook; editor?: ScriptHook }> =>
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

  /**
   * Lima sandbox API
   */
  lima: {
    status: (projectPath: string): Promise<{ available: boolean; vmStatus: string; instanceName?: string; memory?: number; disk?: number }> =>
      ipcRenderer.invoke('lima:status', projectPath),
    start: (projectPath: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('lima:start', projectPath),
    stop: (projectPath: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('lima:stop', projectPath),
    getConfig: (projectPath: string): Promise<{ memoryGiB: number; diskGiB: number }> =>
      ipcRenderer.invoke('lima:get-config', projectPath),
    setConfig: (projectPath: string, config: { memoryGiB?: number; diskGiB?: number }): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('lima:set-config', projectPath, config),
    recreate: (projectPath: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('lima:recreate', projectPath),
    delete: (projectPath: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('lima:delete', projectPath),
    onSpawnProgress: (callback: (message: string) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, message: string) => callback(message);
      ipcRenderer.on('lima:spawn-progress', handler);
      return () => ipcRenderer.removeListener('lima:spawn-progress', handler);
    },
  },
});
