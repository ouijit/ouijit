// Re-export all git types from git.ts (single source of truth)
export type { GitStatus, GitDropdownInfo, ExtendedGitStatus, RecentBranch, UncommittedChanges, ChangedFile, DiffLine, DiffHunk, FileDiff, CompactGitStatus, WorktreeDiffSummary, BranchInfo } from './git';
// Import for local use within this file
import type { GitStatus } from './git';

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
export type HookType = 'start' | 'continue' | 'run' | 'cleanup' | 'sandbox-setup';

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
    cleanup?: ScriptHook;
    'sandbox-setup'?: ScriptHook;
  };
  /** If true, kill existing instances of a command before starting a new one (default: true) */
  killExistingOnRun?: boolean;
  /** Sandbox VM resource configuration */
  sandbox?: { memoryGiB?: number; diskGiB?: number };
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
 * Result of shipping (merging) a worktree branch
 */
export interface ShipItResult {
  success: boolean;
  error?: string;
  conflictFiles?: string[];
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
  /** Whether this terminal is for a worktree */
  isWorktree?: boolean;
  /** Path to the worktree (if isWorktree) */
  worktreePath?: string;
  /** Branch name of the worktree (if isWorktree) */
  worktreeBranch?: string;
  /** Whether this is a runner PTY (secondary terminal for running commands) */
  isRunner?: boolean;
  /** Parent PTY ID if this is a runner (for session restoration) */
  parentPtyId?: PtyId;
  /** Additional environment variables to set */
  env?: Record<string, string>;
  /** Whether to run this terminal inside a Lima sandbox VM */
  sandboxed?: boolean;
}

/**
 * Information about an active PTY session (for reconnection after reload)
 */
export interface ActiveSession {
  ptyId: PtyId;
  projectPath: string;
  command: string;
  label: string;
  isWorktree: boolean;
  worktreePath?: string;
  worktreeBranch?: string;
  /** Whether this is a runner PTY */
  isRunner?: boolean;
  /** Parent PTY ID if this is a runner */
  parentPtyId?: PtyId;
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
  onData(ptyId: PtyId, callback: (data: string) => void): () => void;
  onExit(ptyId: PtyId, callback: (exitCode: number) => void): () => void;
  /** Get list of active sessions (for reconnection after reload) */
  getActiveSessions(): Promise<ActiveSession[]>;
  /** Reconnect to an existing PTY after renderer reload */
  reconnect(ptyId: PtyId): Promise<PtyReconnectResult>;
  /** Update window reference after reconnection */
  setWindow(): void;
}

/**
 * Task metadata for tracking lifecycle state
 */
export interface TaskMetadata {
  taskNumber?: number;      // Sequential number (1, 2, 3...) - displayed as T-{taskNumber}
  branch: string;           // Git branch name
  name: string;             // Display name
  status: 'open' | 'closed';
  createdAt: string;        // ISO timestamp
  closedAt?: string;        // When marked closed
  readyToShip?: boolean;    // "Spiritually done" - code complete, pending merge/review
  prompt?: string;          // Optional task description (OUIJIT_TASK_PROMPT)
  sandboxed?: boolean;      // Whether this task runs in a sandbox VM
}

/**
 * Information about a git worktree
 */
export interface WorktreeInfo {
  path: string;
  branch: string;
  taskName?: string;
  createdAt: string;
}

/**
 * Extended worktree info including task metadata
 */
export interface WorktreeWithMetadata extends WorktreeInfo {
  taskNumber?: number;      // Sequential number - displayed as T-{taskNumber}
  name: string;             // Display name
  status: 'open' | 'closed';
  closedAt?: string;
  readyToShip?: boolean;    // "Spiritually done" - code complete, pending merge/review
  mergeTarget?: string;     // Branch to merge into (defaults to main if unset)
  prompt?: string;          // Optional task description
  sandboxed?: boolean;      // Whether this task runs in a sandbox VM
}

/**
 * Result of creating a task with worktree
 */
export interface WorktreeCreateResult {
  success: boolean;
  task?: TaskMetadata;
  worktreePath?: string;
  error?: string;
}

/**
 * Result of removing a worktree
 */
export interface WorktreeRemoveResult {
  success: boolean;
  error?: string;
}

/**
 * Hooks API exposed to the renderer
 */
export interface HooksAPI {
  /** Get all hooks for a project */
  get(projectPath: string): Promise<{ start?: ScriptHook; continue?: ScriptHook; run?: ScriptHook; cleanup?: ScriptHook; 'sandbox-setup'?: ScriptHook }>;
  /** Save a hook for a project */
  save(projectPath: string, hook: ScriptHook): Promise<{ success: boolean }>;
  /** Delete a hook for a project */
  delete(projectPath: string, hookType: HookType): Promise<{ success: boolean }>;
}

/**
 * Worktree API exposed to the renderer
 */
export interface WorktreeAPI {
  create(projectPath: string, name?: string, prompt?: string): Promise<WorktreeCreateResult>;
  remove(projectPath: string, worktreePath: string): Promise<WorktreeRemoveResult>;
  list(projectPath: string): Promise<WorktreeInfo[]>;
  getDiff(projectPath: string, worktreeBranch: string, targetBranch?: string): Promise<import('./git').WorktreeDiffSummary | null>;
  getFileDiff(projectPath: string, worktreeBranch: string, filePath: string, targetBranch?: string): Promise<import('./git').FileDiff | null>;
  merge(projectPath: string, worktreeBranch: string): Promise<GitMergeResult>;
  /** Ship (merge into target branch) a worktree branch */
  ship(projectPath: string, worktreeBranch: string, commitMessage?: string): Promise<ShipItResult>;
  /** Get tasks with metadata merged with worktree list */
  getTasks(projectPath: string): Promise<WorktreeWithMetadata[]>;
  /** Mark a task as closed (metadata only, keeps worktree) */
  close(projectPath: string, branch: string): Promise<{ success: boolean; error?: string; hookWarning?: string }>;
  /** Reopen a closed task */
  reopen(projectPath: string, branch: string): Promise<{ success: boolean; error?: string }>;
  /** Set a task's ready-to-ship state */
  setReady(projectPath: string, branch: string, ready: boolean): Promise<{ success: boolean; error?: string }>;
  /** List all branches in the project */
  listBranches(projectPath: string): Promise<import('./git').BranchInfo[]>;
  /** Set a task's merge target branch */
  setMergeTarget(projectPath: string, branch: string, mergeTarget: string): Promise<{ success: boolean; error?: string }>;
  /** Set a task's sandboxed state */
  setSandboxed(projectPath: string, branch: string, sandboxed: boolean): Promise<{ success: boolean; error?: string }>;
  /** Get the main branch for a project */
  getMainBranch(projectPath: string): Promise<string>;
}

/**
 * Project interface representing a development project
 */
export interface Project {
  name: string;
  path: string;
  hasGit: boolean;
  hasClaude: boolean;
  lastModified: Date;
  description?: string;
  language?: string;
  iconDataUrl?: string;
}

/**
 * API interface exposed by the preload script
 */
export interface ElectronAPI {
  getProjects(): Promise<Project[]>;
  openProject(path: string): Promise<{ success: boolean }>;
  /** Open project in Finder */
  openInFinder(path: string): Promise<{ success: boolean }>;
  /** PTY management API */
  pty: PtyAPI;
  /** Worktree management API */
  worktree: WorktreeAPI;
  /** Refresh the project list */
  refreshProjects(): Promise<Project[]>;
  /** Get git status (branch and dirty state) for a project */
  getGitStatus(projectPath: string): Promise<GitStatus | null>;
  /** Get compact git status for at-a-glance display */
  getCompactGitStatus(projectPath: string): Promise<import('./git').CompactGitStatus | null>;
  /** Get extended git dropdown info for a project */
  getGitDropdownInfo(projectPath: string): Promise<import('./git').GitDropdownInfo | null>;
  /** Checkout a git branch */
  gitCheckout(projectPath: string, branchName: string): Promise<GitCheckoutResult>;
  /** Create a new git branch */
  gitCreateBranch(projectPath: string, branchName: string): Promise<GitCheckoutResult>;
  /** Merge current branch into main */
  gitMergeIntoMain(projectPath: string): Promise<GitMergeResult>;
  /** Get list of changed files */
  getChangedFiles(projectPath: string): Promise<import('./git').ChangedFile[]>;
  /** Get diff for a specific file */
  getFileDiff(projectPath: string, filePath: string): Promise<import('./git').FileDiff | null>;
  /** Create a new project */
  createProject(options: CreateProjectOptions): Promise<CreateProjectResult>;
  /** Show native folder picker dialog */
  showFolderPicker(): Promise<{ canceled: boolean; filePaths: string[] }>;
  /** Add a project folder to the app */
  addProject(folderPath: string): Promise<{ success: boolean; error?: string }>;
  /** Remove a project folder from the app */
  removeProject(folderPath: string): Promise<{ success: boolean }>;
  /** Listen for fullscreen state changes */
  onFullscreenChange(callback: (isFullscreen: boolean) => void): () => void;
  /** Get project settings */
  getProjectSettings(projectPath: string): Promise<ProjectSettings>;
  /** Set whether to kill existing command instances on run */
  setKillExistingOnRun(projectPath: string, kill: boolean): Promise<{ success: boolean }>;
  /** Script hooks API */
  hooks: HooksAPI;
  /** Get file path from a dropped File object */
  getPathForFile(file: File): string;
  /** Lima sandbox API */
  lima: LimaAPI;
}

/**
 * Lima sandbox API exposed to the renderer
 */
export interface LimaAPI {
  status(projectPath: string): Promise<{ available: boolean; vmStatus: string; instanceName?: string; memory?: number; disk?: number }>;
  stop(projectPath: string): Promise<{ success: boolean; error?: string }>;
  getConfig(projectPath: string): Promise<{ memoryGiB: number; diskGiB: number }>;
  setConfig(projectPath: string, config: { memoryGiB?: number; diskGiB?: number }): Promise<{ success: boolean }>;
  recreate(projectPath: string): Promise<{ success: boolean; error?: string }>;
  onSpawnProgress(callback: (message: string) => void): () => void;
}

/**
 * Options for creating a new project
 */
export interface CreateProjectOptions {
  name: string;
}

/**
 * Result of creating a new project
 */
export interface CreateProjectResult {
  success: boolean;
  projectPath?: string;
  error?: string;
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}
