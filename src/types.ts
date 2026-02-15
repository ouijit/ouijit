// Re-export all git types from git.ts (single source of truth)
export type { GitStatus, GitDropdownInfo, ExtendedGitStatus, RecentBranch, UncommittedChanges, ChangedFile, DiffLine, DiffHunk, FileDiff, CompactGitStatus, WorktreeDiffSummary, BranchInfo } from './git';
// Import for local use within this file
import type { GitStatus, CompactGitStatus, GitDropdownInfo, ChangedFile, FileDiff, WorktreeDiffSummary, BranchInfo } from './git';

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
export type HookType = 'start' | 'continue' | 'run' | 'cleanup' | 'sandbox-setup' | 'editor';

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
    editor?: ScriptHook;
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
}

/**
 * Information about an active PTY session (for reconnection after reload)
 */
export interface ActiveSession {
  ptyId: PtyId;
  projectPath: string;
  command: string;
  label: string;
  taskId?: number;
  worktreePath?: string;
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

export type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done';

export interface TaskMetadata {
  taskNumber: number;
  branch?: string;
  name: string;
  status: TaskStatus;
  createdAt: string;
  closedAt?: string;
  worktreePath?: string;
  mergeTarget?: string;
  prompt?: string;
  sandboxed?: boolean;
}

/**
 * Information about a git worktree
 */
export interface WorktreeInfo {
  path: string;
  branch: string;
  createdAt: string;
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
}

export interface TaskCreateResult {
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
  get(projectPath: string): Promise<{ start?: ScriptHook; continue?: ScriptHook; run?: ScriptHook; cleanup?: ScriptHook; 'sandbox-setup'?: ScriptHook; editor?: ScriptHook }>;
  /** Save a hook for a project */
  save(projectPath: string, hook: ScriptHook): Promise<{ success: boolean }>;
  /** Delete a hook for a project */
  delete(projectPath: string, hookType: HookType): Promise<{ success: boolean }>;
}

export interface TaskAPI {
  create(projectPath: string, name?: string, prompt?: string): Promise<TaskCreateResult>;
  createAndStart(projectPath: string, name?: string, prompt?: string, branchName?: string): Promise<TaskCreateResult>;
  start(projectPath: string, taskNumber: number, branchName?: string): Promise<TaskCreateResult>;
  getAll(projectPath: string): Promise<TaskWithWorkspace[]>;
  getByNumber(projectPath: string, taskNumber: number): Promise<TaskWithWorkspace | null>;
  setStatus(projectPath: string, taskNumber: number, status: TaskStatus): Promise<{ success: boolean; error?: string; hookWarning?: string }>;
  delete(projectPath: string, taskNumber: number): Promise<{ success: boolean; error?: string }>;
  setMergeTarget(projectPath: string, taskNumber: number, mergeTarget: string): Promise<{ success: boolean; error?: string }>;
  setSandboxed(projectPath: string, taskNumber: number, sandboxed: boolean): Promise<{ success: boolean; error?: string }>;
  setName(projectPath: string, taskNumber: number, name: string): Promise<{ success: boolean; error?: string }>;
  setDescription(projectPath: string, taskNumber: number, description: string): Promise<{ success: boolean; error?: string }>;
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
  getFileDiff(projectPath: string, worktreeBranch: string, filePath: string, targetBranch?: string): Promise<FileDiff | null>;
  merge(projectPath: string, worktreeBranch: string): Promise<GitMergeResult>;
  ship(projectPath: string, worktreeBranch: string, commitMessage?: string): Promise<ShipItResult>;
  listBranches(projectPath: string): Promise<BranchInfo[]>;
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
  /** Open a directory in the user's configured code editor */
  openInEditor(projectPath: string, dirPath: string): Promise<{ success: boolean }>;
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
  /** Get compact git status for at-a-glance display */
  getCompactGitStatus(projectPath: string): Promise<CompactGitStatus | null>;
  /** Get extended git dropdown info for a project */
  getGitDropdownInfo(projectPath: string): Promise<GitDropdownInfo | null>;
  /** Checkout a git branch */
  gitCheckout(projectPath: string, branchName: string): Promise<GitCheckoutResult>;
  /** Create a new git branch */
  gitCreateBranch(projectPath: string, branchName: string): Promise<GitCheckoutResult>;
  /** Merge current branch into main */
  gitMergeIntoMain(projectPath: string): Promise<GitMergeResult>;
  /** Get list of changed files */
  getChangedFiles(projectPath: string): Promise<ChangedFile[]>;
  /** Get diff for a specific file */
  getFileDiff(projectPath: string, filePath: string): Promise<FileDiff | null>;
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
  start(projectPath: string): Promise<{ success: boolean; error?: string }>;
  stop(projectPath: string): Promise<{ success: boolean; error?: string }>;
  getConfig(projectPath: string): Promise<{ memoryGiB: number; diskGiB: number }>;
  setConfig(projectPath: string, config: { memoryGiB?: number; diskGiB?: number }): Promise<{ success: boolean }>;
  recreate(projectPath: string): Promise<{ success: boolean; error?: string }>;
  delete(projectPath: string): Promise<{ success: boolean; error?: string }>;
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
