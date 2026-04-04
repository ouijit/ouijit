/**
 * IPC Contract — single source of truth for all channel names, argument types, and return types.
 *
 * Both the main process (ipc/handlers/) and the preload script (preload.ts) import
 * from this file to ensure compile-time type safety across the Electron IPC boundary.
 */

import type {
  Project,
  PtySpawnOptions,
  PtySpawnResult,
  PtyReconnectResult,
  ActiveSession,
  CreateProjectOptions,
  CreateProjectResult,
  ProjectSettings,
  GitStatus,
  GitFileStatus,
  GitDropdownInfo,
  GitCheckoutResult,
  GitMergeResult,
  FileDiff,
  WorktreeDiffSummary,
  WorktreeInfo,
  WorktreeRemoveResult,
  TaskWorktreeResult,
  CheckWorktreeResult,
  TaskWithWorkspace,
  TaskStatus,
  ScriptHook,
  HookType,
  BranchInfo,
  TagRow,
  Script,
} from '../types';
import type { SandboxStatus } from '../lima/types';
import type { HookStatusEntry } from '../hookServer';

/** Hooks object returned by hooks:get — derived from the canonical ProjectSettings type */
export type ProjectHooks = NonNullable<ProjectSettings['hooks']>;

/**
 * Invoke channels: renderer calls via ipcRenderer.invoke(), main responds via ipcMain.handle().
 * Each entry maps a channel name to its positional argument tuple and return type.
 */
export interface IpcInvokeContract {
  // ── Project ──────────────────────────────────────────────────────────
  'get-projects': { args: []; return: Project[] };
  'open-project': { args: [projectPath: string]; return: { success: boolean } };
  'open-in-finder': { args: [projectPath: string]; return: { success: boolean } };
  'open-in-editor': { args: [projectPath: string, dirPath: string]; return: { success: boolean } };
  'open-file-in-editor': {
    args: [projectPath: string, workspaceRoot: string, filePath: string, line?: number, column?: number];
    return: { success: boolean; error?: string };
  };
  'open-external': { args: [url: string]; return: void };
  'refresh-projects': { args: []; return: Project[] };
  'create-project': { args: [options: CreateProjectOptions]; return: CreateProjectResult };
  'show-folder-picker': { args: []; return: { canceled: boolean; filePaths: string[] } };
  'add-project': { args: [folderPath: string]; return: { success: boolean; error?: string } };
  'remove-project': { args: [folderPath: string]; return: { success: boolean } };
  'reorder-projects': { args: [paths: string[]]; return: { success: boolean } };
  'get-project-settings': { args: [projectPath: string]; return: ProjectSettings };
  'settings:set-kill-existing-on-run': { args: [projectPath: string, kill: boolean]; return: { success: boolean } };
  'get-home-path': { args: []; return: string };

  // ── Git ──────────────────────────────────────────────────────────────
  'get-git-status': { args: [projectPath: string]; return: GitStatus | null };
  'get-git-file-status': { args: [projectPath: string]; return: GitFileStatus | null };
  'get-git-dropdown-info': { args: [projectPath: string]; return: GitDropdownInfo | null };
  'git-checkout': { args: [projectPath: string, branchName: string]; return: GitCheckoutResult };
  'git-create-branch': { args: [projectPath: string, branchName: string]; return: GitCheckoutResult };
  'git-merge-into-main': { args: [projectPath: string]; return: GitMergeResult };
  'get-file-diff': { args: [projectPath: string, filePath: string, contextLines?: number]; return: FileDiff | null };

  // ── PTY ──────────────────────────────────────────────────────────────
  'pty:spawn': { args: [options: PtySpawnOptions]; return: PtySpawnResult };
  'pty:get-active-sessions': { args: []; return: ActiveSession[] };
  'pty:reconnect': { args: [ptyId: string]; return: PtyReconnectResult };

  // ── Task ─────────────────────────────────────────────────────────────
  'task:create': { args: [projectPath: string, name?: string, prompt?: string]; return: TaskWorktreeResult };
  'task:create-and-start': {
    args: [projectPath: string, name?: string, prompt?: string, branchName?: string];
    return: TaskWorktreeResult;
  };
  'task:start': { args: [projectPath: string, taskNumber: number, branchName?: string]; return: TaskWorktreeResult };
  'task:get-all': { args: [projectPath: string]; return: TaskWithWorkspace[] };
  'task:get-by-number': { args: [projectPath: string, taskNumber: number]; return: TaskWithWorkspace | null };
  'task:set-status': {
    args: [projectPath: string, taskNumber: number, status: TaskStatus];
    return: { success: boolean; error?: string; hookWarning?: string };
  };
  'task:delete': { args: [projectPath: string, taskNumber: number]; return: { success: boolean; error?: string } };
  'task:trash': {
    args: [projectPath: string, taskNumber: number];
    return: { success: boolean; error?: string; trashed?: boolean };
  };
  'task:set-merge-target': {
    args: [projectPath: string, taskNumber: number, mergeTarget: string];
    return: { success: boolean; error?: string };
  };
  'task:set-sandboxed': {
    args: [projectPath: string, taskNumber: number, sandboxed: boolean];
    return: { success: boolean; error?: string };
  };
  'task:set-name': {
    args: [projectPath: string, taskNumber: number, name: string];
    return: { success: boolean; error?: string };
  };
  'task:set-description': {
    args: [projectPath: string, taskNumber: number, description: string];
    return: { success: boolean; error?: string };
  };
  'task:reorder': {
    args: [projectPath: string, taskNumber: number, newStatus: TaskStatus, targetIndex: number];
    return: { success: boolean; error?: string; hookWarning?: string };
  };
  'task:check-worktree': { args: [projectPath: string, taskNumber: number]; return: CheckWorktreeResult };
  'task:recover': { args: [projectPath: string, taskNumber: number]; return: TaskWorktreeResult };

  // ── Worktree ─────────────────────────────────────────────────────────
  'worktree:validate-branch-name': {
    args: [projectPath: string, branchName: string];
    return: { valid: boolean; error?: string };
  };
  'worktree:generate-branch-name': { args: [projectPath: string, name: string]; return: string };
  'worktree:remove': { args: [projectPath: string, worktreePath: string]; return: WorktreeRemoveResult };
  'worktree:list': { args: [projectPath: string]; return: WorktreeInfo[] };
  'worktree:get-diff': {
    args: [projectPath: string, worktreeBranch: string, targetBranch?: string];
    return: WorktreeDiffSummary | null;
  };
  'worktree:get-file-diff': {
    args: [projectPath: string, worktreeBranch: string, filePath: string, targetBranch?: string, contextLines?: number];
    return: FileDiff | null;
  };
  'worktree:merge': { args: [projectPath: string, worktreeBranch: string]; return: GitMergeResult };
  'worktree:ship': {
    args: [projectPath: string, worktreeBranch: string, commitMessage?: string];
    return: { success: boolean; error?: string; conflictFiles?: string[]; mergedBranch?: string };
  };
  'worktree:list-branches': { args: [projectPath: string]; return: BranchInfo[] };
  'worktree:get-main-branch': { args: [projectPath: string]; return: string };

  // ── Hooks ────────────────────────────────────────────────────────────
  'hooks:get': { args: [projectPath: string]; return: ProjectHooks };
  'hooks:get-status': { args: [ptyId: string]; return: HookStatusEntry | null };
  'hooks:save': { args: [projectPath: string, hook: ScriptHook]; return: { success: boolean } };
  'hooks:delete': { args: [projectPath: string, hookType: HookType]; return: { success: boolean } };

  // ── Plan ─────────────────────────────────────────────────────────────
  'plan:read': { args: [planPath: string]; return: string | null };
  'plan:watch': { args: [planPath: string]; return: { success: boolean } };
  'plan:unwatch': { args: [planPath: string]; return: void };
  'plan:get-for-pty': { args: [ptyId: string]; return: string | null };

  // ── Scripts ──────────────────────────────────────────────────────────
  'scripts:get-all': { args: [projectPath: string]; return: Script[] };
  'scripts:save': { args: [projectPath: string, script: Script]; return: { success: boolean; script?: Script } };
  'scripts:delete': { args: [projectPath: string, scriptId: string]; return: { success: boolean } };
  'scripts:reorder': { args: [projectPath: string, scriptIds: string[]]; return: { success: boolean } };

  // ── Tags ─────────────────────────────────────────────────────────────
  'tags:get-all': { args: []; return: TagRow[] };
  'tags:get-for-task': { args: [projectPath: string, taskNumber: number]; return: TagRow[] };
  'tags:add-to-task': { args: [projectPath: string, taskNumber: number, tagName: string]; return: TagRow };
  'tags:remove-from-task': { args: [projectPath: string, taskNumber: number, tagName: string]; return: void };
  'tags:set-task-tags': { args: [projectPath: string, taskNumber: number, tagNames: string[]]; return: TagRow[] };

  // ── Global Settings ──────────────────────────────────────────────────
  'settings:get-global': { args: [key: string]; return: string | undefined };
  'settings:set-global': { args: [key: string, value: string]; return: { success: boolean } };

  // ── Lima ─────────────────────────────────────────────────────────────
  'lima:status': { args: [projectPath: string]; return: SandboxStatus };
  'lima:start': { args: [projectPath: string]; return: { success: boolean; error?: string } };
  'lima:stop': { args: [projectPath: string]; return: { success: boolean; error?: string } };
  'lima:get-yaml': { args: [projectPath: string]; return: string };
  'lima:set-yaml': { args: [projectPath: string, yaml: string]; return: { success: boolean; error?: string } };
  'lima:get-merged-yaml': { args: [projectPath: string]; return: string };
  'lima:recreate': { args: [projectPath: string]; return: { success: boolean; error?: string } };
  'lima:delete': { args: [projectPath: string]; return: { success: boolean; error?: string } };
}

/**
 * Send channels: renderer fires via ipcRenderer.send(), main receives via ipcMain.on().
 * Fire-and-forget — no response.
 */
export interface IpcSendContract {
  'pty:write': { args: [ptyId: string, data: string] };
  'pty:resize': { args: [ptyId: string, cols: number, rows: number] };
  'pty:kill': { args: [ptyId: string] };
  'pty:set-window': { args: [] };
}

/**
 * Push channels: main fires via webContents.send(), renderer receives via ipcRenderer.on().
 *
 * Note: Dynamic per-PTY channels (pty:data:${ptyId}, pty:exit:${ptyId}) are not
 * included here because their channel names are constructed at runtime. They are
 * handled directly in preload.ts and ptyManager.ts / lima/spawn.ts.
 */
export interface IpcPushContract {
  'fullscreen-change': { args: [isFullscreen: boolean] };
  'claude-hook-status': { args: [ptyId: string, status: import('../hookServer').HookStatus] };
  'claude-plan-detected': { args: [ptyId: string, planPath: string] };
  'claude-plan-ready': { args: [ptyId: string] };
  'plan:content-changed': { args: [planPath: string, content: string] };
  'lima:spawn-progress': { args: [step: { id: string; label: string; status: 'active' | 'done' }] };
  'update-available': { args: [info: { version: string; url: string }] };
  'whats-new': { args: [info: { version: string; notes: string }] };
}
