// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { IpcInvokeContract, IpcSendContract, IpcPushContract } from './ipc/contract';
import type {
  PtyId,
  PtySpawnOptions,
  CreateProjectOptions,
  FolderPickerOptions,
  ProjectsFolderChangeAction,
  TaskStatus,
  ScriptHook,
  HookType,
  Script,
  CliHookMode,
  TaskWithWorkspace,
  NonoConfig,
  CliPanelOp,
  CliPanelResponse,
} from './types';
import type { CaptureNavigatePayload } from './capture/types';
import type {
  CommentKind,
  ReviewEvent,
  MergeOptions,
  GithubDraftsChangedPayload,
  SaveDraftInput,
  PrHead,
} from './github/types';
import type { SaveDiffNoteInput } from './diffNotes';

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
  openFileInEditor: (projectPath: string, workspaceRoot: string, filePath: string, line?: number) =>
    typedInvoke('open-file-in-editor', projectPath, workspaceRoot, filePath, line),
  openExternal: (url: string) => typedInvoke('open-external', url),
  refreshProjects: () => typedInvoke('refresh-projects'),
  createProject: (options: CreateProjectOptions) => typedInvoke('create-project', options),
  showFolderPicker: (options?: FolderPickerOptions) => typedInvoke('show-folder-picker', options),
  getDefaultProjectsFolder: () => typedInvoke('projects:get-default-folder'),
  prepareProjectsFolderChange: (newFolder: string) => typedInvoke('projects:prepare-folder-change', newFolder),
  applyProjectsFolderChange: (newFolder: string, action: ProjectsFolderChangeAction) =>
    typedInvoke('projects:apply-folder-change', newFolder, action),
  addProject: (folderPath: string) => typedInvoke('add-project', folderPath),
  initGitRepo: (folderPath: string, initialCommit?: boolean) => typedInvoke('init-git-repo', folderPath, initialCommit),
  removeProject: (folderPath: string) => typedInvoke('remove-project', folderPath),
  reorderProjects: (paths: string[]) => typedInvoke('reorder-projects', paths),
  setProjectIconColor: (projectPath: string, color: string | null) =>
    typedInvoke('settings:set-project-icon-color', projectPath, color),

  getGitStatus: (projectPath: string) => typedInvoke('get-git-status', projectPath),
  getGitFileStatus: (projectPath: string, diffBase?: string) =>
    typedInvoke('get-git-file-status', projectPath, diffBase),
  getGitDropdownInfo: (projectPath: string) => typedInvoke('get-git-dropdown-info', projectPath),
  listDiffBases: (projectPath: string) => typedInvoke('git-diff-bases', projectPath),
  fetchDiffBase: (projectPath: string, ref: string) => typedInvoke('git-fetch-diff-base', projectPath, ref),
  gitCheckout: (projectPath: string, branchName: string) => typedInvoke('git-checkout', projectPath, branchName),
  gitCreateBranch: (projectPath: string, branchName: string) =>
    typedInvoke('git-create-branch', projectPath, branchName),
  gitMergeIntoMain: (projectPath: string) => typedInvoke('git-merge-into-main', projectPath),
  getFileDiff: (projectPath: string, filePath: string, contextLines: number | undefined, untracked: boolean) =>
    typedInvoke('get-file-diff', projectPath, filePath, contextLines, untracked),

  pty: {
    spawn: (options: PtySpawnOptions) => typedInvoke('pty:spawn', options),
    write: (ptyId: PtyId, data: string) => typedSend('pty:write', ptyId, data),
    resize: (ptyId: PtyId, cols: number, rows: number) => typedSend('pty:resize', ptyId, cols, rows),
    kill: (ptyId: PtyId) => typedSend('pty:kill', ptyId),
    setLabel: (ptyId: PtyId, label: string) => typedSend('pty:set-label', ptyId, label),
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
    getFileDiff: (gitPath: string, base: string, filePath: string, oldPath?: string, contextLines?: number) =>
      typedInvoke('worktree:get-file-diff', gitPath, base, filePath, oldPath, contextLines),
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
    setName: (projectPath: string, taskNumber: number, name: string) =>
      typedInvoke('task:set-name', projectPath, taskNumber, name),
    setDescription: (projectPath: string, taskNumber: number, description: string) =>
      typedInvoke('task:set-description', projectPath, taskNumber, description),
    reorder: (projectPath: string, taskNumber: number, newStatus: TaskStatus, targetIndex: number) =>
      typedInvoke('task:reorder', projectPath, taskNumber, newStatus, targetIndex),
    checkWorktree: (projectPath: string, taskNumber: number) =>
      typedInvoke('task:check-worktree', projectPath, taskNumber),
    recover: (projectPath: string, taskNumber: number) => typedInvoke('task:recover', projectPath, taskNumber),
    createFromTask: (projectPath: string, parentTaskNumber: number, name?: string) =>
      typedInvoke('task:create-from-task', projectPath, parentTaskNumber, name),
    setParent: (projectPath: string, taskNumber: number, parentTaskNumber: number | null, mergeTarget?: string) =>
      typedInvoke('task:set-parent', projectPath, taskNumber, parentTaskNumber, mergeTarget),
    saveAttachment: (data: Uint8Array, ext: string) => typedInvoke('task:save-attachment', data, ext),
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

  agentHooks: {
    onStatus: (callback: (ptyId: string, status: string) => void) => typedListen('agent-hook-status', callback),
    getStatus: (ptyId: string) => typedInvoke('hooks:get-status', ptyId),
  },

  plan: {
    read: (planPath: string) => typedInvoke('plan:read', planPath),
    watch: (planPath: string) => typedInvoke('plan:watch', planPath),
    unwatch: (planPath: string) => typedInvoke('plan:unwatch', planPath),
    onContentChanged: (callback: (planPath: string, content: string) => void) =>
      typedListen('plan:content-changed', callback),
    checkFilesExist: (workspaceRoot: string, filePaths: string[]) =>
      typedInvoke('plan:check-files-exist', workspaceRoot, filePaths),
    pickFile: (defaultPath?: string) => typedInvoke('plan:pick-file', defaultPath),
  },

  cliPanels: {
    onOp: (callback: (op: CliPanelOp) => void) => typedListen('cli:panel-op', callback),
    respond: (requestId: number, response: CliPanelResponse) => typedInvoke('cli-panels:respond', requestId, response),
  },

  globalSettings: {
    get: (key: string) => typedInvoke('settings:get-global', key),
    set: (key: string, value: string) => typedInvoke('settings:set-global', key, value),
  },

  onboarding: {
    seedTask: (projectPath: string) => typedInvoke('onboarding:seed-task', projectPath),
  },

  health: {
    check: () => typedInvoke('health:check'),
    onUpdate: (callback: (status: import('./healthCheck').HealthStatus) => void) => typedListen('health', callback),
  },

  onUpdateAvailable: (callback: (info: { version: string; url: string }) => void) =>
    typedListen('update-available', callback),

  onShellUnsupported: (callback: (info: { shell: string }) => void) => typedListen('shell-unsupported', callback),

  onWhatsNew: (callback: (info: { version: string; notes: string }) => void) => typedListen('whats-new', callback),

  onCliChange: (
    callback: (payload: { project: string; action: string; resource: string; message?: string; ts: number }) => void,
  ) => typedListen('cli-change', callback),

  onCliThemeChanged: (callback: () => void) => typedListen('cli:theme-changed', callback),

  onCliTaskStarted: (
    callback: (payload: {
      project: string;
      taskNumber: number;
      worktreePath: string;
      branch: string;
      createdAt: string;
      hookMode?: CliHookMode;
      hookCommand?: string;
    }) => void,
  ) => typedListen('cli:task-started', callback),

  onCliTaskCompleted: (
    callback: (payload: {
      project: string;
      taskNumber: number;
      task: TaskWithWorkspace;
      hookMode?: CliHookMode;
      hookCommand?: string;
    }) => void,
  ) => typedListen('cli:task-completed', callback),

  onCliTaskTransitioned: (
    callback: (payload: {
      project: string;
      taskNumber: number;
      origStatus: TaskStatus;
      newStatus: TaskStatus;
      task: TaskWithWorkspace;
      hookMode?: CliHookMode;
      hookCommand?: string;
    }) => void,
  ) => typedListen('cli:task-transitioned', callback),

  capture: {
    onNavigate: (callback: (payload: CaptureNavigatePayload) => void) => typedListen('capture:navigate', callback),
  },

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
    onSandboxDiverged: (
      callback: (event: { taskNumber: number; userWorktreePath: string; sandboxViewPath: string }) => void,
    ) => typedListen('sandbox:diverged', callback),
  },
  sandbox: {
    status: (projectPath: string) => typedInvoke('sandbox:status', projectPath),
    nonoConfig: (projectPath: string) => typedInvoke('sandbox:nono-config', projectPath),
    setNonoConfig: (projectPath: string, config: NonoConfig) =>
      typedInvoke('sandbox:set-nono-config', projectPath, config),
  },

  github: {
    availability: (projectPath: string, recheck?: boolean) => typedInvoke('github:availability', projectPath, recheck),
    inbox: (projectPath: string) => typedInvoke('github:inbox', projectPath),
    pullRequest: (projectPath: string, number: number) => typedInvoke('github:pull-request', projectPath, number),
    pullRequestFreshness: (projectPath: string, number: number) =>
      typedInvoke('github:pull-request-freshness', projectPath, number),
    pullRequestFiles: (projectPath: string, number: number, baseSha: string, headSha: string) =>
      typedInvoke('github:pull-request-files', projectPath, number, baseSha, headSha),
    pullRequestFileDiff: (
      projectPath: string,
      number: number,
      baseSha: string,
      headSha: string,
      filePath: string,
      contextLines?: number,
      oldPath?: string,
    ) =>
      typedInvoke(
        'github:pull-request-file-diff',
        projectPath,
        number,
        baseSha,
        headSha,
        filePath,
        contextLines,
        oldPath,
      ),
    pullRequestFileVersions: (
      projectPath: string,
      number: number,
      baseSha: string,
      headSha: string,
      filePath: string,
      oldPath?: string,
    ) => typedInvoke('github:pull-request-file-versions', projectPath, number, baseSha, headSha, filePath, oldPath),
    viewedFiles: (projectPath: string, prNumber: number, headSha: string) =>
      typedInvoke('github:viewed-files', projectPath, prNumber, headSha),
    setFileViewed: (projectPath: string, prNumber: number, headSha: string, path: string, viewed: boolean) =>
      typedInvoke('github:set-file-viewed', projectPath, prNumber, headSha, path, viewed),
    issues: (projectPath: string) => typedInvoke('github:issues', projectPath),
    issue: (projectPath: string, number: number) => typedInvoke('github:issue', projectPath, number),

    linkTaskIssue: (projectPath: string, taskNumber: number, issueNumber: number | null) =>
      typedInvoke('github:link-task-issue', projectPath, taskNumber, issueNumber),
    detectTaskPr: (projectPath: string, taskNumber: number) =>
      typedInvoke('github:detect-task-pr', projectPath, taskNumber),
    detectProjectPrs: (projectPath: string) => typedInvoke('github:detect-project-prs', projectPath),

    drafts: (projectPath: string, prNumber: number, head?: PrHead) =>
      typedInvoke('github:drafts', projectPath, prNumber, head),
    saveDraft: (projectPath: string, input: SaveDraftInput) => typedInvoke('github:save-draft', projectPath, input),
    discardDraft: (projectPath: string, draftId: string) => typedInvoke('github:discard-draft', projectPath, draftId),
    submitReview: (projectPath: string, prNumber: number, event: ReviewEvent, body: string) =>
      typedInvoke('github:submit-review', projectPath, prNumber, event, body),
    comment: (projectPath: string, prNumber: number, body: string) =>
      typedInvoke('github:comment', projectPath, prNumber, body),
    replyToThread: (projectPath: string, prNumber: number, commentId: number, body: string) =>
      typedInvoke('github:reply-to-thread', projectPath, prNumber, commentId, body),
    deleteComment: (projectPath: string, kind: CommentKind, commentId: number) =>
      typedInvoke('github:delete-comment', projectPath, kind, commentId),
    resolveThread: (projectPath: string, threadId: string, resolved: boolean) =>
      typedInvoke('github:resolve-thread', projectPath, threadId, resolved),
    createPr: (
      projectPath: string,
      taskNumber: number,
      options: { title?: string; body?: string; base?: string; draft?: boolean },
    ) => typedInvoke('github:create-pr', projectPath, taskNumber, options),
    mergePr: (projectPath: string, prNumber: number, options: MergeOptions) =>
      typedInvoke('github:merge-pr', projectPath, prNumber, options),
    taskFromIssue: (projectPath: string, issueNumber: number) =>
      typedInvoke('github:task-from-issue', projectPath, issueNumber),
    taskFromPr: (projectPath: string, prNumber: number) => typedInvoke('github:task-from-pr', projectPath, prNumber),

    onDraftsChanged: (callback: (payload: GithubDraftsChangedPayload) => void) =>
      typedListen('github:drafts-changed', callback),
  },

  diffNotes: {
    list: (worktreePath: string, keep?: string[]) => typedInvoke('diff-notes:list', worktreePath, keep),
    save: (input: SaveDiffNoteInput) => typedInvoke('diff-notes:save', input),
    discard: (id: string) => typedInvoke('diff-notes:discard', id),
    clear: (worktreePath: string) => typedInvoke('diff-notes:clear', worktreePath),
  },

  analysis: {
    refresh: (projectPath: string, force?: boolean) => typedInvoke('analysis:refresh', projectPath, force),
    diffSignals: (projectPath: string, paths: string[]) => typedInvoke('analysis:diff-signals', projectPath, paths),
    overview: (projectPath: string) => typedInvoke('analysis:overview', projectPath),
  },
});
