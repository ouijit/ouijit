/**
 * Git status information for a project
 */
export interface GitStatus {
  branch: string;
  isDirty: boolean;
}

// Re-export extended git types from git.ts
export type { GitDropdownInfo, ExtendedGitStatus, RecentBranch, UncommittedChanges, ChangedFile, DiffLine, DiffHunk, FileDiff } from './git';

/**
 * Represents a run configuration for launching a project
 */
export interface RunConfig {
  /** Display name (e.g., "dev", "start", "run") */
  name: string;
  /** Full command to execute */
  command: string;
  /** Source file that defined this config */
  source: 'package.json' | 'Makefile' | 'Cargo.toml' | 'go.mod' | 'pyproject.toml' | 'docker-compose.yml';
  /** Optional description of the command */
  description?: string;
  /** Priority for sorting (lower = higher priority) */
  priority: number;
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
 * Unique identifier for a PTY session
 */
export type PtyId = string;

/**
 * Options for spawning a new PTY
 */
export interface PtySpawnOptions {
  cwd: string;
  /** Command to run. If not provided, spawns an interactive shell */
  command?: string;
  cols?: number;
  rows?: number;
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
 * PTY API exposed to the renderer
 */
export interface PtyAPI {
  spawn(options: PtySpawnOptions): Promise<PtySpawnResult>;
  write(ptyId: PtyId, data: string): void;
  resize(ptyId: PtyId, cols: number, rows: number): void;
  kill(ptyId: PtyId): void;
  onData(ptyId: PtyId, callback: (data: string) => void): () => void;
  onExit(ptyId: PtyId, callback: (exitCode: number) => void): () => void;
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
  /** Get extended git dropdown info for a project */
  getGitDropdownInfo(projectPath: string): Promise<import('./git').GitDropdownInfo | null>;
  /** Checkout a git branch */
  gitCheckout(projectPath: string, branchName: string): Promise<GitCheckoutResult>;
  /** Get list of changed files */
  getChangedFiles(projectPath: string): Promise<import('./git').ChangedFile[]>;
  /** Get diff for a specific file */
  getFileDiff(projectPath: string, filePath: string): Promise<import('./git').FileDiff | null>;
  /** Create a new project */
  createProject(options: CreateProjectOptions): Promise<CreateProjectResult>;
  /** Listen for fullscreen state changes */
  onFullscreenChange(callback: (isFullscreen: boolean) => void): () => void;
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
