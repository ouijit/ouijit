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
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}
