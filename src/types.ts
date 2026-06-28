// Re-export all git types from git.ts (single source of truth)
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
  GitFileStatus,
  WorktreeDiffSummary,
  BranchInfo,
} from './git';
// Re-export worktree types from worktree.ts (single source of truth)
export type { TaskWorktreeResult, WorktreeInfo, WorktreeRemoveResult, CheckWorktreeResult } from './worktree';
// Re-export task types from db layer (single source of truth)
export type { TaskStatus, TaskMetadata } from './db';
// Re-export tag types from db layer (single source of truth)
export type { TagRow } from './db';
// Re-export PTY session type from ptyManager.ts (single source of truth)
export type { ActiveSession } from './ptyManager';
// Re-export sandbox status from lima/types.ts (single source of truth)
export type { SandboxStatus } from './lima/types';
// Re-export hook status types from hookServer.ts (single source of truth)
export type { HookStatus, HookStatusEntry } from './hookServer';

// Import for local use within this file
import type { GitStatus, GitFileStatus, GitDropdownInfo, FileDiff, WorktreeDiffSummary, BranchInfo } from './git';
import type { TaskWorktreeResult, WorktreeInfo, WorktreeRemoveResult, CheckWorktreeResult } from './worktree';
import type { TaskStatus, TagRow } from './db';
import type { ActiveSession } from './ptyManager';
import type { SandboxStatus } from './lima/types';
import type { HookStatus, HookStatusEntry } from './hookServer';

/**
 * Persisted last active view for session recovery
 */
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
export interface SnapshotPanel {
  kind: 'runner' | 'webPreview' | 'plan';
  /** runner */
  scriptName?: string | null;
  scriptCommand?: string | null;
  source?: 'hook' | 'script';
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
  sandboxed: boolean;
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

/**
 * Represents a run configuration for launching a project
 */
export interface RunConfig {
  /** Display name (e.g., "dev", "start", "run") */
  name: string;
  /** Full command to execute */
  command: string;
  /** Source file that defined this config */
  source: 'package.json' | 'Makefile' | 'Cargo.toml' | 'go.mod' | 'pyproject.toml' | 'docker-compose.yml' | 'custom';
  /** Optional description of the command */
  description?: string;
  /** Priority for sorting (lower = higher priority) */
  priority: number;
  /** Whether this is a custom user-defined command */
  isCustom?: boolean;
}

/**
 * Custom command defined by the user
 * @deprecated Use ScriptHook instead
 */
export interface CustomCommand {
  /** Unique identifier */
  id: string;
  /** Display name */
  name: string;
  /** Full command to execute */
  command: string;
  /** Optional description */
  description?: string;
}

/**
 * Hook type - when the script runs
 */
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

/**
 * Script hook configuration
 */
export interface ScriptHook {
  /** Unique identifier */
  id: string;
  /** Hook type - determines when it runs */
  type: HookType;
  /** Display name */
  name: string;
  /** Command to execute */
  command: string;
  /** Optional description */
  description?: string;
}

/**
 * Ad-hoc script configuration (user-defined, project-scoped)
 */
export interface Script {
  id: string;
  name: string;
  command: string;
  sortOrder: number;
}

/**
 * Minimal script reference for runner execution (no persistence concern)
 */
export interface RunnerScript {
  name: string;
  command: string;
}

/**
 * Project-specific settings stored by the app
 */
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
  /** If true, kill existing instances of a command before starting a new one (default: true) */
  killExistingOnRun?: boolean;
}

/**
 * Result of git checkout operation
 */
export interface GitCheckoutResult {
  success: boolean;
  error?: string;
}

/**
 * Result of git merge into main operation
 */
export interface GitMergeResult {
  success: boolean;
  error?: string;
  mergedBranch?: string;
}

/**
 * Unique identifier for a PTY session
 */
export type PtyId = string;

/**
 * Options for spawning a new PTY
 */
export interface PtySpawnOptions {
  cwd: string;
  /** The project this terminal belongs to (for session restoration). Defaults to cwd if not specified. */
  projectPath?: string;
  /** Command to run. If not provided, spawns an interactive shell */
  command?: string;
  cols?: number;
  rows?: number;
  /** Display label for the terminal */
  label?: string;
  /** Task ID for task terminals */
  taskId?: number;
  /** Path to the worktree */
  worktreePath?: string;
  /** Whether this is a runner PTY (secondary terminal for running commands) */
  isRunner?: boolean;
  /** Parent PTY ID if this is a runner (for session restoration) */
  parentPtyId?: PtyId;
  /** Additional environment variables to set */
  env?: Record<string, string>;
  /** Whether to run this terminal inside a Lima sandbox VM */
  sandboxed?: boolean;
  /**
   * Marks a shell owned by the standalone terminal window (opened via the
   * global hotkey / dock / status-bar item) rather than the main app window.
   * Used to partition session reconnection so the two windows don't reclaim
   * each other's shells after a renderer reload.
   */
  standalone?: boolean;
}

/**
 * Result of spawning a PTY
 */
export interface PtySpawnResult {
  success: boolean;
  ptyId?: PtyId;
  error?: string;
}

/**
 * Result of reconnecting to a PTY
 */
export interface PtyReconnectResult {
  success: boolean;
  /** Buffered output that was missed during disconnection */
  bufferedOutput?: string;
  /** Whether the PTY is currently in alternate screen mode (TUI) */
  isAltScreen?: boolean;
  /** Terminal cols at time of last resize (for accurate buffer replay) */
  lastCols?: number;
  /** Terminal rows at time of last resize */
  lastRows?: number;
  error?: string;
}

/**
 * PTY API exposed to the renderer
 */
export interface PtyAPI {
  spawn(options: PtySpawnOptions): Promise<PtySpawnResult>;
  write(ptyId: PtyId, data: string): void;
  resize(ptyId: PtyId, cols: number, rows: number): void;
  kill(ptyId: PtyId): void;
  /** Update a terminal's display label after a user rename */
  setLabel(ptyId: PtyId, label: string): void;
  onData(ptyId: PtyId, callback: (data: string) => void): () => void;
  onExit(ptyId: PtyId, callback: (exitCode: number) => void): () => void;
  /** Get list of active sessions (for reconnection after reload) */
  getActiveSessions(): Promise<ActiveSession[]>;
  /** Reconnect to an existing PTY after renderer reload */
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
  sandboxed?: boolean;
  order?: number;
  parentTaskNumber?: number;
}

/**
 * Hooks API exposed to the renderer
 */
export interface HooksAPI {
  /** Get all hooks for a project */
  get(projectPath: string): Promise<{
    start?: ScriptHook;
    continue?: ScriptHook;
    run?: ScriptHook;
    review?: ScriptHook;
    done?: ScriptHook;
    editor?: ScriptHook;
  }>;
  /** Save a hook for a project */
  save(projectPath: string, hook: ScriptHook): Promise<{ success: boolean }>;
  /** Delete a hook for a project */
  delete(projectPath: string, hookType: HookType): Promise<{ success: boolean }>;
}

export interface TagsAPI {
  getAll(): Promise<TagRow[]>;
  getForTask(projectPath: string, taskNumber: number): Promise<TagRow[]>;
  addToTask(projectPath: string, taskNumber: number, tagName: string): Promise<TagRow>;
  removeFromTask(projectPath: string, taskNumber: number, tagName: string): Promise<void>;
  setTaskTags(projectPath: string, taskNumber: number, tagNames: string[]): Promise<TagRow[]>;
}

/**
 * Scripts API exposed to the renderer
 */
export interface ScriptsAPI {
  /** Get all scripts for a project, ordered by sort_order */
  getAll(projectPath: string): Promise<Script[]>;
  /** Save (create or update) a script */
  save(projectPath: string, script: Script): Promise<{ success: boolean; script?: Script }>;
  /** Delete a script by ID */
  delete(projectPath: string, scriptId: string): Promise<{ success: boolean }>;
  /** Reorder scripts by setting sort_order from array position */
  reorder(projectPath: string, scriptIds: string[]): Promise<{ success: boolean }>;
}

export interface TaskAPI {
  create(projectPath: string, name?: string, prompt?: string): Promise<TaskWorktreeResult>;
  createAndStart(
    projectPath: string,
    name?: string,
    prompt?: string,
    branchName?: string,
    sandboxed?: boolean,
  ): Promise<TaskWorktreeResult>;
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
  setSandboxed(
    projectPath: string,
    taskNumber: number,
    sandboxed: boolean,
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

/**
 * Worktree API exposed to the renderer (git plumbing only — task ops are on TaskAPI)
 */
export interface WorktreeAPI {
  validateBranchName(projectPath: string, branchName: string): Promise<{ valid: boolean; error?: string }>;
  generateBranchName(projectPath: string, name: string): Promise<string>;
  remove(projectPath: string, worktreePath: string): Promise<WorktreeRemoveResult>;
  list(projectPath: string): Promise<WorktreeInfo[]>;
  getDiff(projectPath: string, worktreeBranch: string, targetBranch?: string): Promise<WorktreeDiffSummary | null>;
  getFileDiff(
    projectPath: string,
    worktreeBranch: string,
    filePath: string,
    targetBranch?: string,
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

/**
 * Project interface representing a development project
 */
export interface Project {
  name: string;
  path: string;
  /** Custom icon color override; when unset the color is generated from the name. */
  iconColor?: string;
}

/**
 * API interface exposed by the preload script
 */
export interface ElectronAPI {
  getProjects(): Promise<Project[]>;
  openProject(path: string): Promise<{ success: boolean }>;
  /** Open project in Finder */
  openInFinder(path: string): Promise<{ success: boolean }>;
  /** Open a file at a specific line in the user's editor (auto-detects, falls back to hook) */
  openFileInEditor(
    projectPath: string,
    workspaceRoot: string,
    filePath: string,
    line?: number,
  ): Promise<{ success: boolean; error?: string }>;
  /** Open a URL in the default browser */
  openExternal(url: string): Promise<void>;
  /** PTY management API */
  pty: PtyAPI;
  /** Worktree management API */
  worktree: WorktreeAPI;
  /** Task lifecycle API */
  task: TaskAPI;
  /** Refresh the project list */
  refreshProjects(): Promise<Project[]>;
  /** Get git status (branch and dirty state) for a project */
  getGitStatus(projectPath: string): Promise<GitStatus | null>;
  /** Get detailed file-level git status (single source of truth for button + diff panel) */
  getGitFileStatus(projectPath: string, diffBase?: string): Promise<GitFileStatus | null>;
  /** Get extended git dropdown info for a project */
  getGitDropdownInfo(projectPath: string): Promise<GitDropdownInfo | null>;
  /** Checkout a git branch */
  gitCheckout(projectPath: string, branchName: string): Promise<GitCheckoutResult>;
  /** Create a new git branch */
  gitCreateBranch(projectPath: string, branchName: string): Promise<GitCheckoutResult>;
  /** Merge current branch into main */
  gitMergeIntoMain(projectPath: string): Promise<GitMergeResult>;
  /** Get diff for a specific file */
  getFileDiff(projectPath: string, filePath: string, contextLines?: number): Promise<FileDiff | null>;
  /** Create a new project */
  createProject(options: CreateProjectOptions): Promise<CreateProjectResult>;
  /** Show native folder picker dialog */
  showFolderPicker(options?: FolderPickerOptions): Promise<{ canceled: boolean; filePaths: string[] }>;
  /** Get the folder new projects are created in (setting or built-in default) */
  getDefaultProjectsFolder(): Promise<string>;
  /** Scan a just-added project's parent directory for sibling git repos to offer adding */
  scanSiblingProjects(folderPath: string): Promise<SiblingScanResult>;
  /** Ask to change the projects folder; returns whether affected projects need a user decision */
  prepareProjectsFolderChange(newFolder: string): Promise<ProjectsFolderChangePlan>;
  /** Apply a projects folder change with the user's chosen action for affected projects */
  applyProjectsFolderChange(
    newFolder: string,
    action: ProjectsFolderChangeAction,
  ): Promise<ApplyProjectsFolderChangeResult>;
  /** Add a project folder to the app */
  addProject(folderPath: string): Promise<{ success: boolean; error?: string; reason?: ValidateFolderFailureReason }>;
  /** Initialize a git repository in an existing folder (recovers a non-git folder) */
  initGitRepo(folderPath: string, initialCommit?: boolean): Promise<{ success: boolean; error?: string }>;
  /** Remove a project folder from the app */
  removeProject(folderPath: string): Promise<{ success: boolean }>;
  /** Reorder projects in the sidebar */
  reorderProjects(paths: string[]): Promise<{ success: boolean }>;
  /** Set a custom icon color for a project, or null to revert to the generated color */
  setProjectIconColor(projectPath: string, color: string | null): Promise<{ success: boolean }>;
  /** Listen for fullscreen state changes */
  onFullscreenChange(callback: (isFullscreen: boolean) => void): () => void;
  /** Listen for app update availability (Linux only) */
  onUpdateAvailable(callback: (info: { version: string; url: string }) => void): () => void;
  /** Listen for a spawned shell that has no integration provider (fish/zsh/bash are integrated) */
  onShellUnsupported(callback: (info: { shell: string }) => void): () => void;
  /** Listen for "What's New" on first launch after update */
  onWhatsNew(callback: (info: { version: string; notes: string }) => void): () => void;
  /** Listen for CLI changes (sentinel file written by ouijit CLI) */
  onCliChange(
    callback: (payload: { project: string; action: string; message?: string; ts: number }) => void,
  ): () => void;
  /** Listen for a CLI-initiated task start that requires spawning a terminal */
  onCliTaskStarted(
    callback: (payload: {
      project: string;
      taskNumber: number;
      worktreePath: string;
      branch: string;
      createdAt: string;
      sandboxed: boolean;
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
  /** Get project settings */
  getProjectSettings(projectPath: string): Promise<ProjectSettings>;
  /** Set whether to kill existing command instances on run */
  setKillExistingOnRun(projectPath: string, kill: boolean): Promise<{ success: boolean }>;
  /** Script hooks API */
  hooks: HooksAPI;
  /** Tags API */
  tags: TagsAPI;
  /** Ad-hoc scripts API */
  scripts: ScriptsAPI;
  /** CLI agent hook events (claude/codex/pi/opencode) */
  agentHooks: AgentHooksAPI;
  /** Plan file detection and viewing */
  plan: PlanAPI;
  /** CLI-driven terminal panel ops (markdown / web preview) */
  cliPanels: CliPanelsAPI;
  /** Get file path from a dropped File object */
  getPathForFile(file: File): string;
  /** User's home directory */
  homePath(): Promise<string>;
  /** Read the standalone terminal window's global hotkey (or the default). */
  getTerminalHotkey(): Promise<string>;
  /** Set the standalone terminal window's global hotkey ('' resets to default). */
  setTerminalHotkey(accelerator: string): Promise<{ success: boolean; accelerator: string }>;
  /** Lima sandbox API */
  lima: LimaAPI;
  /** Global settings API */
  globalSettings: GlobalSettingsAPI;
  /** Onboarding API */
  onboarding: OnboardingAPI;
  /** Health probe API (git/claude/lima detection) */
  health: HealthAPI;
  /** Capture-mode API (only populated when OUIJIT_CAPTURE_MODE=1) */
  capture: CaptureAPI;
}

/**
 * Onboarding API exposed to the renderer
 */
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

/**
 * Health probe API exposed to the renderer
 */
export interface HealthAPI {
  check(): Promise<import('./healthCheck').HealthStatus>;
  onUpdate(callback: (status: import('./healthCheck').HealthStatus) => void): () => void;
}

/**
 * Capture-mode API for the screenshot driver.
 */
export interface CaptureAPI {
  onNavigate(callback: (payload: import('./capture/types').CaptureNavigatePayload) => void): () => void;
}

/**
 * CLI agent hook events API exposed to the renderer. Shared by claude / codex / pi / opencode.
 */
export interface AgentHooksAPI {
  onStatus(callback: (ptyId: PtyId, status: HookStatus) => void): () => void;
  getStatus(ptyId: PtyId): Promise<HookStatusEntry | null>;
}

/**
 * Plan file detection and viewing API exposed to the renderer
 */
export interface PlanAPI {
  read(planPath: string): Promise<string | null>;
  watch(planPath: string): Promise<{ success: boolean }>;
  unwatch(planPath: string): Promise<void>;
  getForPty(ptyId: PtyId): Promise<string | null>;
  onDetected(callback: (ptyId: PtyId, planPath: string) => void): () => void;
  onReady(callback: (ptyId: PtyId) => void): () => void;
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
 * Lima sandbox API exposed to the renderer
 */
export interface LimaAPI {
  status(projectPath: string): Promise<SandboxStatus>;
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

/**
 * Global settings API exposed to the renderer
 */
export interface GlobalSettingsAPI {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<{ success: boolean }>;
}

/**
 * Options for creating a new project
 */
export interface CreateProjectOptions {
  name: string;
  /** Directory the project folder is created in. Defaults to the projects folder setting. */
  parentDir?: string;
}

/** Options for the native directory picker */
export interface FolderPickerOptions {
  title?: string;
  buttonLabel?: string;
  defaultPath?: string;
}

/** Result of scanning a just-added project's parent directory for sibling git repos */
export interface SiblingScanResult {
  parentDir: string;
  /** Absolute paths of sibling git repos not yet registered as projects */
  siblings: string[];
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

/** Result of applying a projects folder change with the user's chosen action */
export interface ApplyProjectsFolderChangeResult {
  /** Whether the setting now points at the new folder */
  committed: boolean;
  moved: { from: string; to: string }[];
  failed: { path: string; error: string }[];
}

/**
 * Result of creating a new project
 */
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
