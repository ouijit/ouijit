// Import for local use within this file
import type {
  GitStatus,
  GitFileStatus,
  GitDropdownInfo,
  FileDiff,
  WorktreeDiffSummary,
  BranchInfo,
  DiffBases,
} from './git';
import type { TaskWorktreeResult, WorktreeInfo, WorktreeRemoveResult, CheckWorktreeResult } from './worktree';
import type { AnalysisOverview, DiffSignals } from './analysis/types';
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
  MergeOptions,
  GithubDraftsChangedPayload,
  InboxResult,
  PullRequestFilesResult,
  SaveDraftInput,
  PromoteToTaskResult,
  PrFileVersions,
} from './github/types';
import type { DiffNote, SaveDiffNoteInput } from './diffNotes';
import type { TaskStatus, TagRow } from './db';
import type { ActiveSession } from './ptyManager';
import type { LimaStatus } from './lima/types';
import type { SandboxProviderId, SandboxProviderStatus, NonoConfig } from './sandbox/types';
import type { HookStatus, HookStatusEntry } from './hookServer';

export type {
  GitStatus,
  GitDropdownInfo,
  ExtendedGitStatus,
  RecentBranch,
  UncommittedChanges,
  ChangedFile,
  DiffLine,
  DiffHunk,
  FileDiff,
  BlobContent,
  GitFileStatus,
  WorktreeDiffSummary,
  BranchInfo,
  DiffBaseRef,
  DiffBases,
} from './git';
export type { TaskWorktreeResult, WorktreeInfo, WorktreeRemoveResult, CheckWorktreeResult } from './worktree';
export type { TaskStatus, TaskMetadata } from './db';
export type { TagRow } from './db';
export type { ActiveSession } from './ptyManager';
export type { LimaStatus } from './lima/types';
export type {
  SandboxProviderId,
  SandboxBackendId,
  SandboxProviderStatus,
  SandboxCapabilities,
  NonoConfig,
} from './sandbox/types';
export { SANDBOX_BACKEND_LABELS, legacySandboxProvider, isActiveSandbox } from './sandbox/types';
export type { HookStatus, HookStatusEntry } from './hookServer';
export type {
  RepoIdentity,
  GithubAvailability,
  PullRequestSummary,
  PullRequestDetail,
  PullRequestFreshness,
  PullRequestInbox,
  PullRequestLabel,
  ReviewThread,
  ReviewComment,
  ReviewDraft,
  ReviewEvent,
  MergeMethod,
  MergeOptions,
  MergeStatus,
  GithubIssue,
  IssueDetail,
  CommentKind,
  GithubDraftsChangedPayload,
  CheckRun,
  TimelineItem,
  InboxResult,
  PullRequestFilesResult,
  SaveDraftInput,
  PromoteToTaskResult,
  TaskFromGithubResult,
  SubmitReviewResult,
  PrFileVersions,
} from './github/types';

export type LastActiveView = { type: 'home' } | { type: 'project'; path: string };

/**
 * Per-terminal UI state captured for cross-launch session restore.
 *
 * Lives in `lastSession:snapshot` global setting as JSON. Restoring the live
 * shell process is impossible across an app quit — these fields preserve the
 * configuration around it (plan attachment, panel layout, last runner script
 * to one-click re-run).
 */
/** One persisted user-managed panel in the multi-panel snapshot shape. */
/** Global-settings key the session snapshot persists under. */
export const SNAPSHOT_KEY = 'lastSession:snapshot';

export interface SnapshotPanel {
  kind: 'runner' | 'webPreview' | 'plan';
  /** runner */
  scriptName?: string | null;
  scriptCommand?: string | null;
  source?: 'hook' | 'script';
  restartIfRunning?: boolean;
  /** webPreview (only user-set URLs are persisted) */
  url?: string | null;
  /** plan */
  planPath?: string | null;
}

export interface SnapshotTerminalUi {
  /** New shape: the ordered tab list. Absence means a legacy snapshot. */
  panels?: SnapshotPanel[];
  /** Index of the active panel within `panels`, or null when none was active. */
  activePanelIndex?: number | null;
  /** Whether the active panel was full-width. */
  panelFullWidth?: boolean;
  /** Split position (0–1) of the panel/terminal divider when not full-width. */
  panelSplitRatio?: number;
  /** Automatic diff takeover state (separate from the panel tabs). */
  diffPanelOpen?: boolean;

  // ── Legacy singleton fields (kept optional for back-compat) ──────────
  planPath?: string | null;
  planPanelOpen?: boolean;
  webPreview?: {
    url: string | null;
    panelOpen: boolean;
    fullWidth: boolean;
    splitRatio: number;
  } | null;
  runner?: {
    scriptName: string | null;
    scriptCommand: string;
    panelOpen: boolean;
    fullWidth: boolean;
  } | null;
}

export interface SnapshotTerminal {
  /** Live PTY id at capture time. Useful only for a renderer-reload reconnect
   *  (PTYs survive); meaningless across a full quit. Older snapshots omit it. */
  ptyId?: string;
  projectPath: string;
  taskNumber: number | null;
  worktreePath: string | null;
  worktreeBranch: string | null;
  /** Sandbox backend for the terminal; omitted/'none' for a host shell. */
  sandboxProvider?: SandboxProviderId;
  /** @deprecated Legacy boolean read on restore of pre-provider snapshots. */
  sandboxed?: boolean;
  label: string | null;
  ordinalInProject: number;
  isActiveInProject: boolean;
  ui: SnapshotTerminalUi;
}

export interface LastSessionSnapshot {
  version: 1;
  capturedAt: string;
  activeProjectPath: string | null;
  terminals: SnapshotTerminal[];
}

export interface RunConfig {
  /** Display name (e.g., "dev", "start", "run") */
  name: string;
  command: string;
  source: 'package.json' | 'Makefile' | 'Cargo.toml' | 'go.mod' | 'pyproject.toml' | 'docker-compose.yml' | 'custom';
  /** Optional description of the command */
  description?: string;
  /** Priority for sorting (lower = higher priority) */
  priority: number;
  isCustom?: boolean;
}

/**
 * Custom command defined by the user
 * @deprecated Use ScriptHook instead
 */
export interface CustomCommand {
  id: string;
  name: string;
  command: string;
  description?: string;
}

export type HookType = 'start' | 'continue' | 'run' | 'review' | 'done' | 'editor';

/**
 * Hook-control mode from the `ouijit task start` CLI flags. Threads from the
 * CLI through the task-start API into the renderer to bypass the start-hook
 * dialog so an agent can start a task headlessly.
 *  - `run`: run the configured hook for the transition (plain shell if none).
 *  - `skip`: spawn the terminal but run no hook.
 *  - `command`: run a one-off command instead of the configured hook.
 */
export type CliHookMode = 'run' | 'skip' | 'command';

export interface ScriptHook {
  id: string;
  type: HookType;
  name: string;
  command: string;
  description?: string;
  /** Restart the command if an instance is already running in the same task (run hook only). */
  restartIfRunning?: boolean;
}

export interface Script {
  id: string;
  name: string;
  command: string;
  sortOrder: number;
  /** Restart the command if an instance is already running in the same task. */
  restartIfRunning: boolean;
}

/** A script the runner can execute, with no persistence concern. */
export interface RunnerScript {
  name: string;
  command: string;
  /** Restart the command if an instance is already running in the same task. */
  restartIfRunning?: boolean;
}

export interface ProjectSettings {
  /** @deprecated Use hooks instead */
  customCommands?: CustomCommand[];
  /** @deprecated Use hooks.run instead */
  defaultCommandId?: string;
  /** Script hooks for project lifecycle */
  hooks?: {
    start?: ScriptHook;
    continue?: ScriptHook;
    run?: ScriptHook;
    review?: ScriptHook;
    done?: ScriptHook;
    editor?: ScriptHook;
  };
}

export interface GitCheckoutResult {
  success: boolean;
  error?: string;
}

export interface GitMergeResult {
  success: boolean;
  error?: string;
  mergedBranch?: string;
}

export type PtyId = string;

export interface PtySpawnOptions {
  cwd: string;
  /** The project this terminal belongs to (for session restoration). Defaults to cwd if not specified. */
  projectPath?: string;
  /** Command to run. If not provided, spawns an interactive shell */
  command?: string;
  cols?: number;
  rows?: number;
  label?: string;
  taskId?: number;
  worktreePath?: string;
  /** Whether this is a runner PTY (secondary terminal for running commands) */
  isRunner?: boolean;
  /** Parent PTY ID if this is a runner (for session restoration) */
  parentPtyId?: PtyId;
  env?: Record<string, string>;
  /** Which sandbox backend runs this terminal, or omitted/'none' for a host shell. */
  sandboxProvider?: SandboxProviderId;
}

export interface PtySpawnResult {
  success: boolean;
  ptyId?: PtyId;
  error?: string;
}

export interface PtyReconnectResult {
  success: boolean;
  bufferedOutput?: string;
  /** Whether the PTY is currently in alternate screen mode (TUI) */
  isAltScreen?: boolean;
  /** Terminal cols at time of last resize (for accurate buffer replay) */
  lastCols?: number;
  lastRows?: number;
  error?: string;
}

export interface PtyAPI {
  spawn(options: PtySpawnOptions): Promise<PtySpawnResult>;
  write(ptyId: PtyId, data: string): void;
  resize(ptyId: PtyId, cols: number, rows: number): void;
  kill(ptyId: PtyId): void;
  setLabel(ptyId: PtyId, label: string): void;
  onData(ptyId: PtyId, callback: (data: string) => void): () => void;
  onExit(ptyId: PtyId, callback: (exitCode: number) => void): () => void;
  getActiveSessions(): Promise<ActiveSession[]>;
  reconnect(ptyId: PtyId): Promise<PtyReconnectResult>;
  /** Update window reference after reconnection */
  setWindow(): void;
}

export interface TaskWithWorkspace {
  taskNumber: number;
  name: string;
  status: TaskStatus;
  branch?: string;
  worktreePath?: string;
  createdAt: string;
  closedAt?: string;
  mergeTarget?: string;
  prompt?: string;
  order?: number;
  parentTaskNumber?: number;
  /** Linked GitHub pull request, if any. Drives the kanban card badge. */
  githubPrNumber?: number;
  /** Linked GitHub issue, if the task was created from one. */
  githubIssueNumber?: number;
}

export interface HooksAPI {
  get(projectPath: string): Promise<{
    start?: ScriptHook;
    continue?: ScriptHook;
    run?: ScriptHook;
    review?: ScriptHook;
    done?: ScriptHook;
    editor?: ScriptHook;
  }>;
  save(projectPath: string, hook: ScriptHook): Promise<{ success: boolean }>;
  delete(projectPath: string, hookType: HookType): Promise<{ success: boolean }>;
}

export interface TagsAPI {
  getAll(): Promise<TagRow[]>;
  getForTask(projectPath: string, taskNumber: number): Promise<TagRow[]>;
  addToTask(projectPath: string, taskNumber: number, tagName: string): Promise<TagRow>;
  removeFromTask(projectPath: string, taskNumber: number, tagName: string): Promise<void>;
  setTaskTags(projectPath: string, taskNumber: number, tagNames: string[]): Promise<TagRow[]>;
}

export interface ScriptsAPI {
  /** Get all scripts for a project, ordered by sort_order */
  getAll(projectPath: string): Promise<Script[]>;
  /** Save (create or update) a script */
  save(projectPath: string, script: Script): Promise<{ success: boolean; script?: Script }>;
  delete(projectPath: string, scriptId: string): Promise<{ success: boolean }>;
  /** Reorder scripts by setting sort_order from array position */
  reorder(projectPath: string, scriptIds: string[]): Promise<{ success: boolean }>;
}

export interface TaskAPI {
  create(projectPath: string, name?: string, prompt?: string): Promise<TaskWorktreeResult>;
  createAndStart(projectPath: string, name?: string, prompt?: string, branchName?: string): Promise<TaskWorktreeResult>;
  start(projectPath: string, taskNumber: number, branchName?: string): Promise<TaskWorktreeResult>;
  getAll(projectPath: string): Promise<TaskWithWorkspace[]>;
  getByNumber(projectPath: string, taskNumber: number): Promise<TaskWithWorkspace | null>;
  setStatus(
    projectPath: string,
    taskNumber: number,
    status: TaskStatus,
  ): Promise<{ success: boolean; error?: string; hookWarning?: string }>;
  delete(projectPath: string, taskNumber: number): Promise<{ success: boolean; error?: string }>;
  trash(projectPath: string, taskNumber: number): Promise<{ success: boolean; error?: string; trashed?: boolean }>;
  setMergeTarget(
    projectPath: string,
    taskNumber: number,
    mergeTarget: string,
  ): Promise<{ success: boolean; error?: string }>;
  setName(projectPath: string, taskNumber: number, name: string): Promise<{ success: boolean; error?: string }>;
  setDescription(
    projectPath: string,
    taskNumber: number,
    description: string,
  ): Promise<{ success: boolean; error?: string }>;
  reorder(
    projectPath: string,
    taskNumber: number,
    newStatus: TaskStatus,
    targetIndex: number,
  ): Promise<{ success: boolean; error?: string; hookWarning?: string }>;
  checkWorktree(projectPath: string, taskNumber: number): Promise<CheckWorktreeResult>;
  recover(projectPath: string, taskNumber: number): Promise<TaskWorktreeResult>;
  createFromTask(projectPath: string, parentTaskNumber: number, name?: string): Promise<TaskWorktreeResult>;
  setParent(
    projectPath: string,
    taskNumber: number,
    parentTaskNumber: number | null,
    mergeTarget?: string,
  ): Promise<{ success: boolean; error?: string }>;
  saveAttachment(data: Uint8Array, ext: string): Promise<{ success: boolean; path?: string; error?: string }>;
}

/** Git plumbing only; task operations live on TaskAPI. */
export interface WorktreeAPI {
  validateBranchName(projectPath: string, branchName: string): Promise<{ valid: boolean; error?: string }>;
  generateBranchName(projectPath: string, name: string): Promise<string>;
  remove(projectPath: string, worktreePath: string): Promise<WorktreeRemoveResult>;
  list(projectPath: string): Promise<WorktreeInfo[]>;
  getDiff(projectPath: string, worktreeBranch: string, targetBranch?: string): Promise<WorktreeDiffSummary | null>;
  /** One file, as it differs between `base` and the working tree at `gitPath`. */
  getFileDiff(
    gitPath: string,
    base: string,
    filePath: string,
    oldPath?: string,
    contextLines?: number,
  ): Promise<FileDiff | null>;
  merge(projectPath: string, worktreeBranch: string): Promise<GitMergeResult>;
  ship(
    projectPath: string,
    worktreeBranch: string,
    commitMessage?: string,
  ): Promise<{ success: boolean; error?: string; conflictFiles?: string[]; mergedBranch?: string }>;
  listBranches(projectPath: string): Promise<BranchInfo[]>;
  getMainBranch(projectPath: string): Promise<string>;
}

export interface Project {
  name: string;
  path: string;
  /** Custom icon color override; when unset the color is generated from the name. */
  iconColor?: string;
}

export interface ElectronAPI {
  getProjects(): Promise<Project[]>;
  openProject(path: string): Promise<{ success: boolean; error?: string }>;
  /** Reveal a directory in the OS file manager (Finder, Explorer, ...) */
  openInFinder(path: string): Promise<{ success: boolean; error?: string }>;
  /** Open a file at a specific line in the user's editor (auto-detects, falls back to hook) */
  openFileInEditor(
    projectPath: string,
    workspaceRoot: string,
    filePath: string,
    line?: number,
  ): Promise<{ success: boolean; error?: string }>;
  openExternal(url: string): Promise<void>;
  pty: PtyAPI;
  worktree: WorktreeAPI;
  task: TaskAPI;
  refreshProjects(): Promise<Project[]>;
  /** Get git status (branch and dirty state) for a project */
  getGitStatus(projectPath: string): Promise<GitStatus | null>;
  getGitFileStatus(projectPath: string, diffBase?: string): Promise<GitFileStatus | null>;
  getGitDropdownInfo(projectPath: string): Promise<GitDropdownInfo | null>;
  /** The refs a branch diff can be taken against, and when the repo last fetched. */
  listDiffBases(projectPath: string): Promise<DiffBases>;
  /** Update one remote-tracking ref, so a comparison against it is current. */
  fetchDiffBase(projectPath: string, ref: string): Promise<{ success: boolean; error?: string }>;
  gitCheckout(projectPath: string, branchName: string): Promise<GitCheckoutResult>;
  gitCreateBranch(projectPath: string, branchName: string): Promise<GitCheckoutResult>;
  gitMergeIntoMain(projectPath: string): Promise<GitMergeResult>;
  /**
   * Get diff for a specific file. `untracked` is required: working it out in
   * main would mean listing every untracked path in the repo, once per file.
   */
  getFileDiff(
    projectPath: string,
    filePath: string,
    contextLines: number | undefined,
    untracked: boolean,
  ): Promise<FileDiff | null>;
  createProject(options: CreateProjectOptions): Promise<CreateProjectResult>;
  showFolderPicker(options?: FolderPickerOptions): Promise<{ canceled: boolean; filePaths: string[] }>;
  /** Get the folder new projects are created in (setting or built-in default) */
  getDefaultProjectsFolder(): Promise<string>;
  /** Ask to change the projects folder; returns whether affected projects need a user decision */
  prepareProjectsFolderChange(newFolder: string): Promise<ProjectsFolderChangePlan>;
  /** Apply a projects folder change with the user's chosen action for affected projects */
  applyProjectsFolderChange(
    newFolder: string,
    action: ProjectsFolderChangeAction,
  ): Promise<ApplyProjectsFolderChangeResult>;
  addProject(folderPath: string): Promise<{ success: boolean; error?: string; reason?: ValidateFolderFailureReason }>;
  /** Initialize a git repository in an existing folder (recovers a non-git folder) */
  initGitRepo(folderPath: string, initialCommit?: boolean): Promise<{ success: boolean; error?: string }>;
  removeProject(folderPath: string): Promise<{ success: boolean }>;
  reorderProjects(paths: string[]): Promise<{ success: boolean }>;
  /** Set a custom icon color for a project, or null to revert to the generated color */
  setProjectIconColor(projectPath: string, color: string | null): Promise<{ success: boolean }>;
  onFullscreenChange(callback: (isFullscreen: boolean) => void): () => void;
  /** Listen for app update availability (Linux only) */
  onUpdateAvailable(callback: (info: { version: string; url: string }) => void): () => void;
  /** Listen for a spawned shell that has no integration provider (fish/zsh/bash are integrated) */
  onShellUnsupported(callback: (info: { shell: string }) => void): () => void;
  /** Listen for "What's New" on first launch after update */
  onWhatsNew(callback: (info: { version: string; notes: string }) => void): () => void;
  /** Listen for CLI changes (sentinel file written by ouijit CLI) */
  onCliChange(
    callback: (payload: { project: string; action: string; resource: string; message?: string; ts: number }) => void,
  ): () => void;
  /** Listen for a CLI theme mutation — re-read and re-apply theme settings */
  onCliThemeChanged(callback: () => void): () => void;
  /** Listen for a CLI-initiated task start that requires spawning a terminal */
  onCliTaskStarted(
    callback: (payload: {
      project: string;
      taskNumber: number;
      worktreePath: string;
      branch: string;
      createdAt: string;
      hookMode?: CliHookMode;
      hookCommand?: string;
    }) => void,
  ): () => void;
  /** Listen for a CLI-initiated done transition that needs terminal cleanup + hook spawn */
  onCliTaskCompleted(
    callback: (payload: {
      project: string;
      taskNumber: number;
      task: TaskWithWorkspace;
      hookMode?: CliHookMode;
      hookCommand?: string;
    }) => void,
  ): () => void;
  /** Listen for a CLI-initiated in_progress/in_review transition that needs a hook spawn */
  onCliTaskTransitioned(
    callback: (payload: {
      project: string;
      taskNumber: number;
      origStatus: TaskStatus;
      newStatus: TaskStatus;
      task: TaskWithWorkspace;
      hookMode?: CliHookMode;
      hookCommand?: string;
    }) => void,
  ): () => void;
  hooks: HooksAPI;
  tags: TagsAPI;
  scripts: ScriptsAPI;
  /** CLI agent hook events (claude/codex/pi/opencode) */
  agentHooks: AgentHooksAPI;
  plan: PlanAPI;
  /** CLI-driven terminal panel ops (markdown / web preview) */
  cliPanels: CliPanelsAPI;
  /** Get file path from a dropped File object */
  getPathForFile(file: File): string;
  homePath(): Promise<string>;
  lima: LimaAPI;
  sandbox: SandboxAPI;
  globalSettings: GlobalSettingsAPI;
  onboarding: OnboardingAPI;
  /** Health probe API (git/claude/lima detection) */
  health: HealthAPI;
  /** Capture-mode API (only populated when OUIJIT_CAPTURE_MODE=1) */
  capture: CaptureAPI;
  /** GitHub pull requests and issues, via the `gh` CLI on the host */
  github: GithubAPI;
  /** Notes written on a worktree's own diff */
  diffNotes: DiffNotesAPI;
  /** Hotspot, coupling, and ownership signals mined from git history */
  analysis: AnalysisAPI;
}

/**
 * The reads answer null while the behavioural-analysis flag is off, so callers
 * need no gate of their own. The underlying model is a per-project in-memory
 * cache in the main process, rebuilt from `git log` on demand.
 */
export interface AnalysisAPI {
  refresh(projectPath: string, force?: boolean): Promise<void>;
  diffSignals(projectPath: string, paths: string[]): Promise<DiffSignals | null>;
  overview(projectPath: string): Promise<AnalysisOverview | null>;
}

/**
 * Notes on a worktree diff. Unlike `github.drafts` there is no submit step: a
 * note ends when the code it was written about does.
 */
export interface DiffNotesAPI {
  /**
   * Sweeps before it answers, so a note whose code has gone is never handed
   * back. `keep` holds one back regardless — the note open for editing, which
   * would take what is being typed with it.
   */
  list(worktreePath: string, keep?: string[]): Promise<DiffNote[]>;
  save(input: SaveDiffNoteInput): Promise<{ success: boolean }>;
  discard(id: string): Promise<{ success: boolean }>;
  clear(worktreePath: string): Promise<{ success: boolean }>;
}

/**
 * Every call crosses into the main process and shells out to `gh`. No token
 * exists to expose: auth lives entirely in the user's `gh` installation.
 */
export interface GithubAPI {
  availability(projectPath: string, recheck?: boolean): Promise<GithubAvailability>;
  inbox(projectPath: string): Promise<InboxResult>;
  pullRequest(projectPath: string, number: number): Promise<PullRequestDetail>;
  pullRequestFreshness(projectPath: string, number: number): Promise<PullRequestFreshness>;
  pullRequestFiles(
    projectPath: string,
    number: number,
    baseSha: string,
    headSha: string,
  ): Promise<PullRequestFilesResult>;
  pullRequestFileDiff(
    projectPath: string,
    number: number,
    baseSha: string,
    headSha: string,
    filePath: string,
    contextLines?: number,
    oldPath?: string,
  ): Promise<FileDiff | null>;
  pullRequestFileVersions(
    projectPath: string,
    number: number,
    baseSha: string,
    headSha: string,
    filePath: string,
    oldPath?: string,
  ): Promise<PrFileVersions>;
  issues(projectPath: string): Promise<GithubIssue[]>;
  issue(projectPath: string, number: number): Promise<IssueDetail>;

  linkTaskIssue(projectPath: string, taskNumber: number, issueNumber: number | null): Promise<GithubActionResult>;
  detectTaskPr(projectPath: string, taskNumber: number): Promise<{ prNumber: number | null }>;
  detectProjectPrs(projectPath: string): Promise<{ linked: number }>;

  /**
   * Given the head being viewed, drafts written against an earlier one are
   * followed into it first, and the ones that could not be placed come back
   * marked.
   */
  drafts(projectPath: string, prNumber: number, head?: PrHead): Promise<ReviewDraft[]>;
  saveDraft(projectPath: string, input: SaveDraftInput): Promise<ReviewDraft>;
  discardDraft(projectPath: string, draftId: string): Promise<{ success: boolean }>;
  submitReview(
    projectPath: string,
    prNumber: number,
    event: ReviewEvent,
    body: string,
  ): Promise<GithubActionResult & { url?: string }>;
  comment(projectPath: string, prNumber: number, body: string): Promise<GithubActionResult>;
  replyToThread(projectPath: string, prNumber: number, commentId: number, body: string): Promise<GithubActionResult>;
  deleteComment(projectPath: string, kind: CommentKind, commentId: number): Promise<GithubActionResult>;
  resolveThread(projectPath: string, threadId: string, resolved: boolean): Promise<GithubActionResult>;
  createPr(
    projectPath: string,
    taskNumber: number,
    options: { title?: string; body?: string; base?: string; draft?: boolean },
  ): Promise<GithubActionResult & { url?: string; prNumber?: number }>;
  mergePr(projectPath: string, prNumber: number, options: MergeOptions): Promise<GithubActionResult>;
  taskFromIssue(projectPath: string, issueNumber: number): Promise<GithubActionResult & { taskNumber?: number }>;
  taskFromPr(projectPath: string, prNumber: number): Promise<PromoteToTaskResult>;

  viewedFiles(projectPath: string, prNumber: number, headSha: string): Promise<string[]>;
  setFileViewed(
    projectPath: string,
    prNumber: number,
    headSha: string,
    path: string,
    viewed: boolean,
  ): Promise<string[]>;

  onDraftsChanged(callback: (payload: GithubDraftsChangedPayload) => void): () => void;
}

export interface GithubActionResult {
  success: boolean;
  error?: string;
}

export interface OnboardingAPI {
  seedTask(projectPath: string): Promise<{ success: boolean }>;
}

/**
 * Whether the user's first project was created fresh or added from an
 * existing folder. Used to vary the intro stage lead.
 */
export type FirstProjectSource = 'created' | 'added';

/**
 * All first-run onboarding state, stored as a single JSON blob under the
 * `onboarding:state` global setting. Single read on mount, single write per
 * transition. The seeded task itself lives in the task table — only the
 * task number is kept here so the panel can resolve it.
 *
 * `version` exists for schema evolution: bump the constant in
 * `src/onboardingState.ts` and add migration logic to `normalizeOnboardingState`
 * when the shape changes.
 */
export interface OnboardingState {
  version: number;
  firstProjectPath: string;
  source: FirstProjectSource;
  seededTaskNumber: number | null;
  dismissed: boolean;
}

export interface HealthAPI {
  check(): Promise<import('./healthCheck').HealthStatus>;
  onUpdate(callback: (status: import('./healthCheck').HealthStatus) => void): () => void;
}

export interface CaptureAPI {
  onNavigate(callback: (payload: import('./capture/types').CaptureNavigatePayload) => void): () => void;
}

/** CLI agent hook events, covering claude, codex, pi and opencode alike. */
export interface AgentHooksAPI {
  onStatus(callback: (ptyId: PtyId, status: HookStatus) => void): () => void;
  getStatus(ptyId: PtyId): Promise<HookStatusEntry | null>;
}

/** Backs the "Markdown File" panel. */
export interface PlanAPI {
  read(planPath: string): Promise<string | null>;
  watch(planPath: string): Promise<{ success: boolean }>;
  unwatch(planPath: string): Promise<void>;
  onContentChanged(callback: (planPath: string, content: string) => void): () => void;
  checkFilesExist(workspaceRoot: string, filePaths: string[]): Promise<Record<string, boolean>>;
  pickFile(defaultPath?: string): Promise<{ canceled: boolean; filePath: string | null }>;
}

/**
 * CLI-driven terminal panel operations. The CLI (and agents) can add, list, and
 * remove the two user-addressable panel kinds — markdown files and web previews
 * — on a given terminal. The renderer owns the live panel list, so these ops are
 * a request/response bridge: the main process forwards the op to the renderer,
 * which mutates the terminal and replies with the resulting panel set.
 *
 * A terminal's panel kind is `'plan'` internally; the CLI surfaces it as
 * `'markdown'` to match the UI's "Markdown File" tab.
 */
export type CliPanelKind = 'markdown' | 'preview';

/** A single panel as reported back to the CLI. */
export interface CliPanelInfo {
  kind: CliPanelKind;
  /** Tab label shown in the UI. */
  label: string;
  /** Absolute file path — markdown panels only. */
  path?: string;
  /** Preview URL — preview panels only. */
  url?: string;
  /** Whether this panel is the terminal's active (foreground) panel. */
  active: boolean;
}

/** Op forwarded from the main process to the renderer over IPC. */
export interface CliPanelOp {
  /** Correlates the renderer's reply with the awaiting main-process request. */
  requestId: number;
  ptyId: PtyId;
  action: 'list' | 'add' | 'remove';
  kind: CliPanelKind;
  /** Absolute path (markdown) or URL (preview) for add/remove. */
  value?: string;
}

/** Renderer's reply for a {@link CliPanelOp}. */
export interface CliPanelResponse {
  ok: boolean;
  /** Present when ok=false — a human-readable reason (e.g. terminal not found). */
  error?: string;
  /** The terminal's panels of the op's kind after the op ran. */
  panels?: CliPanelInfo[];
}

export interface CliPanelsAPI {
  onOp(callback: (op: CliPanelOp) => void): () => void;
  respond(requestId: number, response: CliPanelResponse): Promise<void>;
}

/**
 * Cross-provider sandbox API exposed to the renderer. Provider-neutral: it
 * reports availability for every registered backend. Backend-specific config
 * lives on its own API surface (e.g. LimaAPI for the YAML editor).
 */
export interface SandboxAPI {
  /** Availability + readiness of every registered sandbox backend. */
  status(projectPath: string): Promise<SandboxProviderStatus[]>;
  nonoConfig(projectPath: string): Promise<NonoConfig>;
  setNonoConfig(projectPath: string, config: NonoConfig): Promise<{ success: boolean }>;
}

export interface LimaAPI {
  status(projectPath: string): Promise<LimaStatus>;
  start(projectPath: string): Promise<{ success: boolean; error?: string }>;
  stop(projectPath: string): Promise<{ success: boolean; error?: string }>;
  getYaml(projectPath: string): Promise<string>;
  setYaml(projectPath: string, yaml: string): Promise<{ success: boolean; error?: string }>;
  getMergedYaml(projectPath: string): Promise<string>;
  recreate(projectPath: string): Promise<{ success: boolean; error?: string }>;
  delete(projectPath: string): Promise<{ success: boolean; error?: string }>;
  onSpawnProgress(callback: (step: { id: string; label: string; status: 'active' | 'done' }) => void): () => void;
  onSandboxDiverged(
    callback: (event: { taskNumber: number; userWorktreePath: string; sandboxViewPath: string }) => void,
  ): () => void;
}

export interface GlobalSettingsAPI {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<{ success: boolean }>;
}

export interface CreateProjectOptions {
  name: string;
  /** Directory the project folder is created in. Defaults to the projects folder setting. */
  parentDir?: string;
}

export interface FolderPickerOptions {
  title?: string;
  buttonLabel?: string;
  defaultPath?: string;
}

/** What happens to projects living in the old folder when the projects folder setting changes */
export type ProjectsFolderChangeAction = 'move' | 'forget' | 'keep';

/** A registered project living in the current projects folder, affected by changing it */
export interface AffectedProject {
  path: string;
  name: string;
  /** Project has running terminal sessions and can't be moved until they're closed */
  hasActiveSessions: boolean;
}

/**
 * Result of asking the main process to change the projects folder setting.
 *
 * committed: no projects were affected, the setting changed immediately.
 * needs-decision: projects live in the current folder; ask the user what
 * happens to them, then call applyProjectsFolderChange.
 * unchanged: the chosen folder is already the setting.
 * invalid: the folder can't be used; `error` says why.
 */
export interface ProjectsFolderChangePlan {
  status: 'committed' | 'needs-decision' | 'unchanged' | 'invalid';
  error?: string;
  affected: AffectedProject[];
}

export interface ApplyProjectsFolderChangeResult {
  /** Whether the setting now points at the new folder */
  committed: boolean;
  moved: { from: string; to: string }[];
  failed: { path: string; error: string }[];
}

export interface CreateProjectResult {
  success: boolean;
  projectPath?: string;
  error?: string;
}

/** Why a picked folder failed project validation. `not-a-git-repo` is recoverable via `initGitRepo`. */
export type ValidateFolderFailureReason = 'not-found' | 'not-a-directory' | 'not-a-git-repo';

declare global {
  interface Window {
    api: ElectronAPI;
  }
}
