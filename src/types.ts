// Re-export all git types from git.ts (single source of truth)
export type { GitStatus, GitDropdownInfo, ExtendedGitStatus, RecentBranch, UncommittedChanges, ChangedFile, DiffLine, DiffHunk, FileDiff, CompactGitStatus, WorktreeDiffSummary } from './git';
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
 * Project-specific settings stored by the app
 */
export interface ProjectSettings {
  /** Custom commands added by the user */
  customCommands: CustomCommand[];
  /** ID of the default command (custom ID or detected command key like "package.json:dev") */
  defaultCommandId?: string;
}

/**
 * Result of launching a project
 */
export interface LaunchResult {
  success: boolean;
  error?: string;
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
  branch: string;           // Unique identifier (the branch name)
  name: string;             // Display name
  status: 'open' | 'closed';
  createdAt: string;        // ISO timestamp
  closedAt?: string;        // When marked closed
}

/**
 * Information about a git worktree
 */
export interface WorktreeInfo {
  path: string;
  branch: string;
  createdAt: string;
}

/**
 * Extended worktree info including task metadata
 */
export interface WorktreeWithMetadata extends WorktreeInfo {
  name: string;             // Display name
  status: 'open' | 'closed';
  closedAt?: string;
}

/**
 * Result of creating a worktree
 */
export interface WorktreeCreateResult {
  success: boolean;
  worktree?: WorktreeInfo;
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
 * Worktree API exposed to the renderer
 */
export interface WorktreeAPI {
  create(projectPath: string, name?: string): Promise<WorktreeCreateResult>;
  remove(projectPath: string, worktreePath: string): Promise<WorktreeRemoveResult>;
  list(projectPath: string): Promise<WorktreeInfo[]>;
  getDiff(projectPath: string, worktreeBranch: string): Promise<import('./git').WorktreeDiffSummary | null>;
  getFileDiff(projectPath: string, worktreeBranch: string, filePath: string): Promise<import('./git').FileDiff | null>;
  merge(projectPath: string, worktreeBranch: string): Promise<GitMergeResult>;
  /** Get tasks with metadata merged with worktree list */
  getTasks(projectPath: string): Promise<WorktreeWithMetadata[]>;
  /** Mark a task as closed (metadata only, keeps worktree) */
  close(projectPath: string, branch: string): Promise<{ success: boolean; error?: string }>;
  /** Reopen a closed task */
  reopen(projectPath: string, branch: string): Promise<{ success: boolean; error?: string }>;
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
  /** Detected run configurations */
  runConfigs?: RunConfig[];
}

/**
 * API interface exposed by the preload script
 */
export interface ElectronAPI {
  getProjects(): Promise<Project[]>;
  openProject(path: string): Promise<{ success: boolean }>;
  /** Launch a project with a specific run config */
  launchProject(projectPath: string, runConfig: RunConfig): Promise<LaunchResult>;
  /** Open project in Finder */
  openInFinder(path: string): Promise<{ success: boolean }>;
  /** PTY management API */
  pty: PtyAPI;
  /** Worktree management API */
  worktree: WorktreeAPI;
  /** Export a project as .ouijit file */
  exportProject(projectPath: string): Promise<ExportResult>;
  /** Preview a .ouijit file before importing */
  previewOuijitFile(filePath: string): Promise<PreviewResult>;
  /** Import a previewed .ouijit package */
  importOuijitPackage(tempDir: string): Promise<ImportResult>;
  /** Open file dialog to select a .ouijit file */
  openOuijitFileDialog(): Promise<string | null>;
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
  /** Listen for fullscreen state changes */
  onFullscreenChange(callback: (isFullscreen: boolean) => void): () => void;
  /** Get project settings (custom commands, default command) */
  getProjectSettings(projectPath: string): Promise<ProjectSettings>;
  /** Save a custom command for a project */
  saveCustomCommand(projectPath: string, command: CustomCommand): Promise<{ success: boolean }>;
  /** Delete a custom command */
  deleteCustomCommand(projectPath: string, commandId: string): Promise<{ success: boolean }>;
  /** Set the default command for a project */
  setDefaultCommand(projectPath: string, commandId: string | null): Promise<{ success: boolean }>;
}

/**
 * Manifest for a .ouijit package file
 */
export interface OuijitManifest {
  version: 1;

  // Display
  name: string;
  tagline?: string;

  // Runtime
  runtime: 'node' | 'python' | 'go' | 'rust' | 'static' | 'unknown';
  runtimeVersion?: string;
  entrypoint?: string;

  // Provenance
  createdAt: string;
  createdBy?: string;
  sourceRepo?: string;
  sourceCommit?: string;

  // Integrity
  sourceChecksum: string;
}

/**
 * A parsed .ouijit package ready for import
 */
export interface OuijitPackage {
  manifest: OuijitManifest;
  screenshotPath?: string;
  sourcePath: string;
  tempDir: string;
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

/**
 * Result of exporting a project
 */
export interface ExportResult {
  success: boolean;
  outputPath?: string;
  sizeBytes?: number;
  error?: string;
}

/**
 * Result of previewing a .ouijit file
 */
export interface PreviewResult {
  success: boolean;
  package?: OuijitPackage;
  error?: string;
}

/**
 * Result of importing a .ouijit package
 */
export interface ImportResult {
  success: boolean;
  projectPath?: string;
  error?: string;
}

declare global {
  interface Window {
    api: ElectronAPI;
    electronAPI?: {
      getPathForFile: (file: File) => string;
    };
  }
}
