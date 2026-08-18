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
  DiffBases,
  FileDiff,
  WorktreeDiffSummary,
  WorktreeInfo,
  WorktreeRemoveResult,
  TaskWorktreeResult,
  CheckWorktreeResult,
  TaskWithWorkspace,
  CliHookMode,
  TaskStatus,
  ScriptHook,
  HookType,
  BranchInfo,
  TagRow,
  Script,
  ValidateFolderFailureReason,
  FolderPickerOptions,
  SiblingScanResult,
  ProjectsFolderChangePlan,
  ProjectsFolderChangeAction,
  ApplyProjectsFolderChangeResult,
  CliPanelOp,
  CliPanelResponse,
} from '../types';
import type { LimaStatus } from '../lima/types';
import type {
  GithubAvailability,
  PullRequestDetail,
  PullRequestFreshness,
  GithubIssue,
  IssueDetail,
  CommentKind,
  ReviewDraft,
  PrHead,
  ReviewEvent,
  MergeMethod,
  GithubDraftsChangedPayload,
  InboxResult,
  PullRequestFilesResult,
  SaveDraftInput,
  PromoteToTaskResult,
  PrFileVersions,
} from '../github/types';
import type { DiffNote, SaveDiffNoteInput } from '../diffNotes';
import type { SandboxProviderStatus, NonoConfig } from '../sandbox/types';
import type { HookStatusEntry } from '../hookServer';
import type { HealthStatus } from '../healthCheck';
import type { CaptureNavigatePayload } from '../capture/types';

/** Hooks object returned by hooks:get — derived from the canonical ProjectSettings type */
export type ProjectHooks = NonNullable<ProjectSettings['hooks']>;

/**
 * Invoke channels: renderer calls via ipcRenderer.invoke(), main responds via ipcMain.handle().
 * Each entry maps a channel name to its positional argument tuple and return type.
 */
export interface IpcInvokeContract {
  // ── Project ──────────────────────────────────────────────────────────
  'get-projects': { args: []; return: Project[] };
  'open-project': { args: [projectPath: string]; return: { success: boolean; error?: string } };
  'open-in-finder': { args: [projectPath: string]; return: { success: boolean; error?: string } };
  'open-file-in-editor': {
    args: [projectPath: string, workspaceRoot: string, filePath: string, line?: number];
    return: { success: boolean; error?: string };
  };
  'open-external': { args: [url: string]; return: void };
  'refresh-projects': { args: []; return: Project[] };
  'create-project': { args: [options: CreateProjectOptions]; return: CreateProjectResult };
  'show-folder-picker': { args: [options?: FolderPickerOptions]; return: { canceled: boolean; filePaths: string[] } };
  'projects:get-default-folder': { args: []; return: string };
  'projects:scan-siblings': { args: [folderPath: string]; return: SiblingScanResult };
  'projects:prepare-folder-change': { args: [newFolder: string]; return: ProjectsFolderChangePlan };
  'projects:apply-folder-change': {
    args: [newFolder: string, action: ProjectsFolderChangeAction];
    return: ApplyProjectsFolderChangeResult;
  };
  'add-project': {
    args: [folderPath: string];
    return: { success: boolean; error?: string; reason?: ValidateFolderFailureReason };
  };
  'init-git-repo': {
    args: [folderPath: string, initialCommit?: boolean];
    return: { success: boolean; error?: string };
  };
  'remove-project': { args: [folderPath: string]; return: { success: boolean } };
  'reorder-projects': { args: [paths: string[]]; return: { success: boolean } };
  'settings:set-project-icon-color': {
    args: [projectPath: string, color: string | null];
    return: { success: boolean };
  };
  'get-home-path': { args: []; return: string };

  // ── Git ──────────────────────────────────────────────────────────────
  'get-git-status': { args: [projectPath: string]; return: GitStatus | null };
  'get-git-file-status': { args: [projectPath: string, diffBase?: string]; return: GitFileStatus | null };
  'get-git-dropdown-info': { args: [projectPath: string]; return: GitDropdownInfo | null };
  'git-diff-bases': { args: [projectPath: string]; return: DiffBases };
  'git-fetch-diff-base': {
    args: [projectPath: string, ref: string];
    return: { success: boolean; error?: string };
  };
  'git-checkout': { args: [projectPath: string, branchName: string]; return: GitCheckoutResult };
  'git-create-branch': { args: [projectPath: string, branchName: string]; return: GitCheckoutResult };
  'git-merge-into-main': { args: [projectPath: string]; return: GitMergeResult };
  'get-file-diff': {
    args: [projectPath: string, filePath: string, contextLines: number | undefined, untracked: boolean];
    return: FileDiff | null;
  };

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
  'task:create-from-task': {
    args: [projectPath: string, parentTaskNumber: number, name?: string];
    return: TaskWorktreeResult;
  };
  'task:set-parent': {
    args: [projectPath: string, taskNumber: number, parentTaskNumber: number | null, mergeTarget?: string];
    return: { success: boolean; error?: string };
  };
  'task:save-attachment': {
    args: [data: Uint8Array, ext: string];
    return: { success: boolean; path?: string; error?: string };
  };

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
    args: [gitPath: string, base: string, filePath: string, oldPath?: string, contextLines?: number];
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
  'plan:check-files-exist': { args: [workspaceRoot: string, filePaths: string[]]; return: Record<string, boolean> };
  'plan:pick-file': { args: [defaultPath?: string]; return: { canceled: boolean; filePath: string | null } };

  // ── CLI panel ops (renderer → main reply for a cli:panel-op push) ─────
  'cli-panels:respond': { args: [requestId: number, response: CliPanelResponse]; return: void };

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

  // ── Onboarding ───────────────────────────────────────────────────────
  'onboarding:seed-task': { args: [projectPath: string]; return: { success: boolean } };

  // ── Health ───────────────────────────────────────────────────────────
  'health:check': { args: []; return: HealthStatus };

  // ── Sandbox (cross-provider) ─────────────────────────────────────────
  'sandbox:status': { args: [projectPath: string]; return: SandboxProviderStatus[] };
  'sandbox:nono-config': { args: [projectPath: string]; return: NonoConfig };
  'sandbox:set-nono-config': { args: [projectPath: string, config: NonoConfig]; return: { success: boolean } };

  // ── GitHub ───────────────────────────────────────────────────────────
  // Every one of these runs `gh` on the host from the main process. No token
  // is ever read, stored, or handed to a renderer or a sandbox guest.
  'github:availability': { args: [projectPath: string, recheck?: boolean]; return: GithubAvailability };
  'github:inbox': { args: [projectPath: string]; return: InboxResult };
  'github:pull-request': { args: [projectPath: string, number: number]; return: PullRequestDetail };
  'github:pull-request-files': {
    args: [projectPath: string, number: number, baseSha: string, headSha: string];
    return: PullRequestFilesResult;
  };
  'github:pull-request-file-diff': {
    args: [
      projectPath: string,
      number: number,
      baseSha: string,
      headSha: string,
      filePath: string,
      contextLines?: number,
      oldPath?: string,
    ];
    return: FileDiff | null;
  };
  'github:pull-request-freshness': { args: [projectPath: string, number: number]; return: PullRequestFreshness };
  'github:pull-request-file-versions': {
    args: [projectPath: string, number: number, baseSha: string, headSha: string, filePath: string, oldPath?: string];
    return: PrFileVersions;
  };
  'github:viewed-files': { args: [projectPath: string, prNumber: number, headSha: string]; return: string[] };
  'github:set-file-viewed': {
    args: [projectPath: string, prNumber: number, headSha: string, path: string, viewed: boolean];
    return: string[];
  };
  'github:issues': { args: [projectPath: string]; return: GithubIssue[] };
  'github:issue': { args: [projectPath: string, number: number]; return: IssueDetail };

  'github:link-task-pr': {
    args: [projectPath: string, taskNumber: number, prNumber: number | null];
    return: { success: boolean; error?: string };
  };
  'github:link-task-issue': {
    args: [projectPath: string, taskNumber: number, issueNumber: number | null];
    return: { success: boolean; error?: string };
  };
  'github:detect-task-pr': { args: [projectPath: string, taskNumber: number]; return: { prNumber: number | null } };

  // ── Diff notes ─────────────────────────────────────────────────────
  // Notes on a worktree's own diff, keyed by the worktree rather than by a pull
  // request, since they are handed to the agent working in it rather than sent.
  'diff-notes:list': { args: [worktreePath: string, keep?: string[]]; return: DiffNote[] };
  'diff-notes:save': { args: [input: SaveDiffNoteInput]; return: { success: boolean } };
  'diff-notes:discard': { args: [id: string]; return: { success: boolean } };
  'diff-notes:clear': { args: [worktreePath: string]; return: { success: boolean } };

  'github:drafts': { args: [projectPath: string, prNumber: number, head?: PrHead]; return: ReviewDraft[] };
  'github:save-draft': { args: [projectPath: string, input: SaveDraftInput]; return: ReviewDraft };
  'github:discard-draft': { args: [projectPath: string, draftId: string]; return: { success: boolean } };
  'github:submit-review': {
    args: [projectPath: string, prNumber: number, event: ReviewEvent, body: string];
    return: { success: boolean; error?: string; url?: string };
  };
  'github:comment': {
    args: [projectPath: string, prNumber: number, body: string];
    return: { success: boolean; error?: string };
  };
  'github:reply-to-thread': {
    args: [projectPath: string, prNumber: number, commentId: number, body: string];
    return: { success: boolean; error?: string };
  };
  'github:delete-comment': {
    args: [projectPath: string, kind: CommentKind, commentId: number];
    return: { success: boolean; error?: string };
  };
  'github:resolve-thread': {
    args: [projectPath: string, threadId: string, resolved: boolean];
    return: { success: boolean; error?: string };
  };
  'github:create-pr': {
    args: [
      projectPath: string,
      taskNumber: number,
      options: { title?: string; body?: string; base?: string; draft?: boolean },
    ];
    return: { success: boolean; error?: string; url?: string; prNumber?: number };
  };
  'github:merge-pr': {
    args: [projectPath: string, prNumber: number, method: MergeMethod, deleteBranch: boolean];
    return: { success: boolean; error?: string };
  };
  'github:task-from-issue': {
    args: [projectPath: string, issueNumber: number];
    return: { success: boolean; error?: string; taskNumber?: number };
  };
  'github:task-from-pr': { args: [projectPath: string, prNumber: number]; return: PromoteToTaskResult };

  // ── Lima ─────────────────────────────────────────────────────────────
  'lima:status': { args: [projectPath: string]; return: LimaStatus };
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
  'pty:set-label': { args: [ptyId: string, label: string] };
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
  'agent-hook-status': { args: [ptyId: string, status: import('../hookServer').HookStatus] };
  'cli:panel-op': { args: [op: CliPanelOp] };
  'plan:content-changed': { args: [planPath: string, content: string] };
  'lima:spawn-progress': { args: [step: { id: string; label: string; status: 'active' | 'done' }] };
  'sandbox:diverged': {
    args: [event: { taskNumber: number; userWorktreePath: string; sandboxViewPath: string }];
  };
  health: { args: [status: HealthStatus] };
  'update-available': { args: [info: { version: string; url: string }] };
  'shell-unsupported': { args: [info: { shell: string }] };
  'whats-new': { args: [info: { version: string; notes: string }] };
  'cli-change': {
    args: [
      payload: {
        project: string;
        action: string;
        /** First path segment of the mutated route ('tasks', 'scripts', 'hooks', …). */
        resource: string;
        message?: string;
        ts: number;
      },
    ];
  };
  /** A CLI theme mutation wrote global settings — re-read and re-apply. */
  'cli:theme-changed': { args: [] };
  'cli:task-started': {
    args: [
      payload: {
        project: string;
        taskNumber: number;
        worktreePath: string;
        branch: string;
        createdAt: string;
        /** Hook-control mode from the CLI flags; absent = default dialog. */
        hookMode?: CliHookMode;
        /** Custom command when hookMode is 'command'. */
        hookCommand?: string;
      },
    ];
  };
  'cli:task-completed': {
    args: [
      payload: {
        project: string;
        taskNumber: number;
        /** Full task record fetched server-side, so the renderer doesn't need to
         *  look it up in projectStore.tasks (which only holds the *active*
         *  project's tasks — would miss when the user is viewing a different project). */
        task: TaskWithWorkspace;
        /** Hook-control mode from the CLI flags; absent = default Done dialog. */
        hookMode?: CliHookMode;
        /** Custom command when hookMode is 'command'. */
        hookCommand?: string;
      },
    ];
  };
  'cli:task-transitioned': {
    args: [
      payload: {
        project: string;
        taskNumber: number;
        /** Status before the CLI write — disambiguates start vs continue. */
        origStatus: TaskStatus;
        /** Status the CLI just wrote (in_progress or in_review). */
        newStatus: TaskStatus;
        /** Full task record fetched server-side (same rationale as cli:task-completed). */
        task: TaskWithWorkspace;
        /** Hook-control mode from the CLI flags; absent = default dialog. */
        hookMode?: CliHookMode;
        /** Custom command when hookMode is 'command'. */
        hookCommand?: string;
      },
    ];
  };
  'capture:navigate': { args: [payload: CaptureNavigatePayload] };
  /** A review draft was written or discarded outside the renderer (the CLI). */
  'github:drafts-changed': { args: [payload: GithubDraftsChangedPayload] };
}
