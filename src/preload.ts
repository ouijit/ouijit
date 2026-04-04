// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { IpcInvokeContract, IpcSendContract, IpcPushContract } from './ipc/contract';
import type { PtyId, PtySpawnOptions, CreateProjectOptions, TaskStatus, ScriptHook, HookType, Script } from './types';

// ── Typed IPC helpers ───────────────────────────────────────────────────────
// These ensure channel names, argument types, and return types are all
// checked against the IPC contract at compile time.

function typedInvoke<C extends keyof IpcInvokeContract>(
  channel: C,
  ...args: IpcInvokeContract[C]['args']
): Promise<IpcInvokeContract[C]['return']> {
  return ipcRenderer.invoke(channel, ...args);
}

function typedSend<C extends keyof IpcSendContract>(channel: C, ...args: IpcSendContract[C]['args']): void {
  ipcRenderer.send(channel, ...args);
}

function typedListen<C extends keyof IpcPushContract>(
  channel: C,
  callback: (...args: IpcPushContract[C]['args']) => void,
): () => void {
  const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]) =>
    (callback as (...a: unknown[]) => void)(...args);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

// ── Exposed API ─────────────────────────────────────────────────────────────
// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('api', {
  getProjects: () => typedInvoke('get-projects'),
  openProject: (path: string) => typedInvoke('open-project', path),
  openInFinder: (path: string) => typedInvoke('open-in-finder', path),
  openInEditor: (projectPath: string, dirPath: string) => typedInvoke('open-in-editor', projectPath, dirPath),
  openFileInEditor: (projectPath: string, workspaceRoot: string, filePath: string, line?: number, column?: number) =>
    typedInvoke('open-file-in-editor', projectPath, workspaceRoot, filePath, line, column),
  openExternal: (url: string) => typedInvoke('open-external', url),
  refreshProjects: () => typedInvoke('refresh-projects'),
  createProject: (options: CreateProjectOptions) => typedInvoke('create-project', options),
  showFolderPicker: () => typedInvoke('show-folder-picker'),
  addProject: (folderPath: string) => typedInvoke('add-project', folderPath),
  removeProject: (folderPath: string) => typedInvoke('remove-project', folderPath),
  reorderProjects: (paths: string[]) => typedInvoke('reorder-projects', paths),
  getProjectSettings: (projectPath: string) => typedInvoke('get-project-settings', projectPath),
  setKillExistingOnRun: (projectPath: string, kill: boolean) =>
    typedInvoke('settings:set-kill-existing-on-run', projectPath, kill),

  getGitStatus: (projectPath: string) => typedInvoke('get-git-status', projectPath),
  getGitFileStatus: (projectPath: string) => typedInvoke('get-git-file-status', projectPath),
  getGitDropdownInfo: (projectPath: string) => typedInvoke('get-git-dropdown-info', projectPath),
  gitCheckout: (projectPath: string, branchName: string) => typedInvoke('git-checkout', projectPath, branchName),
  gitCreateBranch: (projectPath: string, branchName: string) =>
    typedInvoke('git-create-branch', projectPath, branchName),
  gitMergeIntoMain: (projectPath: string) => typedInvoke('git-merge-into-main', projectPath),
  getFileDiff: (projectPath: string, filePath: string, contextLines?: number) =>
    typedInvoke('get-file-diff', projectPath, filePath, contextLines),

  pty: {
    spawn: (options: PtySpawnOptions) => typedInvoke('pty:spawn', options),
    write: (ptyId: PtyId, data: string) => typedSend('pty:write', ptyId, data),
    resize: (ptyId: PtyId, cols: number, rows: number) => typedSend('pty:resize', ptyId, cols, rows),
    kill: (ptyId: PtyId) => typedSend('pty:kill', ptyId),
    getActiveSessions: () => typedInvoke('pty:get-active-sessions'),
    reconnect: (ptyId: PtyId) => typedInvoke('pty:reconnect', ptyId),
    setWindow: () => typedSend('pty:set-window'),

    // Dynamic per-PTY channels — not in the contract since names are constructed at runtime
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

  worktree: {
    validateBranchName: (projectPath: string, branchName: string) =>
      typedInvoke('worktree:validate-branch-name', projectPath, branchName),
    generateBranchName: (projectPath: string, name: string) =>
      typedInvoke('worktree:generate-branch-name', projectPath, name),
    remove: (projectPath: string, worktreePath: string) => typedInvoke('worktree:remove', projectPath, worktreePath),
    list: (projectPath: string) => typedInvoke('worktree:list', projectPath),
    getDiff: (projectPath: string, worktreeBranch: string, targetBranch?: string) =>
      typedInvoke('worktree:get-diff', projectPath, worktreeBranch, targetBranch),
    getFileDiff: (
      projectPath: string,
      worktreeBranch: string,
      filePath: string,
      targetBranch?: string,
      contextLines?: number,
    ) => typedInvoke('worktree:get-file-diff', projectPath, worktreeBranch, filePath, targetBranch, contextLines),
    merge: (projectPath: string, worktreeBranch: string) => typedInvoke('worktree:merge', projectPath, worktreeBranch),
    ship: (projectPath: string, worktreeBranch: string, commitMessage?: string) =>
      typedInvoke('worktree:ship', projectPath, worktreeBranch, commitMessage),
    listBranches: (projectPath: string) => typedInvoke('worktree:list-branches', projectPath),
    getMainBranch: (projectPath: string) => typedInvoke('worktree:get-main-branch', projectPath),
  },

  task: {
    create: (projectPath: string, name?: string, prompt?: string) =>
      typedInvoke('task:create', projectPath, name, prompt),
    createAndStart: (projectPath: string, name?: string, prompt?: string, branchName?: string) =>
      typedInvoke('task:create-and-start', projectPath, name, prompt, branchName),
    start: (projectPath: string, taskNumber: number, branchName?: string) =>
      typedInvoke('task:start', projectPath, taskNumber, branchName),
    getAll: (projectPath: string) => typedInvoke('task:get-all', projectPath),
    getByNumber: (projectPath: string, taskNumber: number) =>
      typedInvoke('task:get-by-number', projectPath, taskNumber),
    setStatus: (projectPath: string, taskNumber: number, status: TaskStatus) =>
      typedInvoke('task:set-status', projectPath, taskNumber, status),
    delete: (projectPath: string, taskNumber: number) => typedInvoke('task:delete', projectPath, taskNumber),
    trash: (projectPath: string, taskNumber: number) => typedInvoke('task:trash', projectPath, taskNumber),
    setMergeTarget: (projectPath: string, taskNumber: number, mergeTarget: string) =>
      typedInvoke('task:set-merge-target', projectPath, taskNumber, mergeTarget),
    setSandboxed: (projectPath: string, taskNumber: number, sandboxed: boolean) =>
      typedInvoke('task:set-sandboxed', projectPath, taskNumber, sandboxed),
    setName: (projectPath: string, taskNumber: number, name: string) =>
      typedInvoke('task:set-name', projectPath, taskNumber, name),
    setDescription: (projectPath: string, taskNumber: number, description: string) =>
      typedInvoke('task:set-description', projectPath, taskNumber, description),
    reorder: (projectPath: string, taskNumber: number, newStatus: TaskStatus, targetIndex: number) =>
      typedInvoke('task:reorder', projectPath, taskNumber, newStatus, targetIndex),
    checkWorktree: (projectPath: string, taskNumber: number) =>
      typedInvoke('task:check-worktree', projectPath, taskNumber),
    recover: (projectPath: string, taskNumber: number) => typedInvoke('task:recover', projectPath, taskNumber),
  },

  hooks: {
    get: (projectPath: string) => typedInvoke('hooks:get', projectPath),
    save: (projectPath: string, hook: ScriptHook) => typedInvoke('hooks:save', projectPath, hook),
    delete: (projectPath: string, hookType: HookType) => typedInvoke('hooks:delete', projectPath, hookType),
  },

  scripts: {
    getAll: (projectPath: string) => typedInvoke('scripts:get-all', projectPath),
    save: (projectPath: string, script: Script) => typedInvoke('scripts:save', projectPath, script),
    delete: (projectPath: string, scriptId: string) => typedInvoke('scripts:delete', projectPath, scriptId),
    reorder: (projectPath: string, scriptIds: string[]) => typedInvoke('scripts:reorder', projectPath, scriptIds),
  },

  tags: {
    getAll: () => typedInvoke('tags:get-all'),
    getForTask: (projectPath: string, taskNumber: number) => typedInvoke('tags:get-for-task', projectPath, taskNumber),
    addToTask: (projectPath: string, taskNumber: number, tagName: string) =>
      typedInvoke('tags:add-to-task', projectPath, taskNumber, tagName),
    removeFromTask: (projectPath: string, taskNumber: number, tagName: string) =>
      typedInvoke('tags:remove-from-task', projectPath, taskNumber, tagName),
    setTaskTags: (projectPath: string, taskNumber: number, tagNames: string[]) =>
      typedInvoke('tags:set-task-tags', projectPath, taskNumber, tagNames),
  },

  onFullscreenChange: (callback: (isFullscreen: boolean) => void) => typedListen('fullscreen-change', callback),

  claudeHooks: {
    onStatus: (callback: (ptyId: string, status: string) => void) => typedListen('claude-hook-status', callback),
    getStatus: (ptyId: string) => typedInvoke('hooks:get-status', ptyId),
  },

  plan: {
    read: (planPath: string) => typedInvoke('plan:read', planPath),
    watch: (planPath: string) => typedInvoke('plan:watch', planPath),
    unwatch: (planPath: string) => typedInvoke('plan:unwatch', planPath),
    getForPty: (ptyId: string) => typedInvoke('plan:get-for-pty', ptyId),
    onDetected: (callback: (ptyId: string, planPath: string) => void) => typedListen('claude-plan-detected', callback),
    onReady: (callback: (ptyId: string) => void) => typedListen('claude-plan-ready', callback),
    onContentChanged: (callback: (planPath: string, content: string) => void) =>
      typedListen('plan:content-changed', callback),
    checkFilesExist: (workspaceRoot: string, filePaths: string[]) =>
      typedInvoke('plan:check-files-exist', workspaceRoot, filePaths),
  },

  globalSettings: {
    get: (key: string) => typedInvoke('settings:get-global', key),
    set: (key: string, value: string) => typedInvoke('settings:set-global', key, value),
  },

  onUpdateAvailable: (callback: (info: { version: string; url: string }) => void) =>
    typedListen('update-available', callback),

  onWhatsNew: (callback: (info: { version: string; notes: string }) => void) => typedListen('whats-new', callback),

  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  homePath: (): Promise<string> => typedInvoke('get-home-path'),

  lima: {
    status: (projectPath: string) => typedInvoke('lima:status', projectPath),
    start: (projectPath: string) => typedInvoke('lima:start', projectPath),
    stop: (projectPath: string) => typedInvoke('lima:stop', projectPath),
    getYaml: (projectPath: string) => typedInvoke('lima:get-yaml', projectPath),
    setYaml: (projectPath: string, yaml: string) => typedInvoke('lima:set-yaml', projectPath, yaml),
    getMergedYaml: (projectPath: string) => typedInvoke('lima:get-merged-yaml', projectPath),
    recreate: (projectPath: string) => typedInvoke('lima:recreate', projectPath),
    delete: (projectPath: string) => typedInvoke('lima:delete', projectPath),
    onSpawnProgress: (callback: (step: { id: string; label: string; status: 'active' | 'done' }) => void) =>
      typedListen('lima:spawn-progress', callback),
  },
});
