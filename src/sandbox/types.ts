/**
 * Cross-provider sandbox types.
 *
 * Pure leaf module — it imports nothing, so `src/types.ts` can re-export these
 * without creating a dependency cycle. The provider interface lives in
 * `./provider` and is used only by main-process code.
 */

/** Identifies which sandbox backend runs a task's terminals and hooks. */
export type SandboxProviderId = 'none' | 'nono' | 'custom';

/** A registered backend id (everything except the pass-through 'none'). */
export type SandboxBackendId = Exclude<SandboxProviderId, 'none'>;

/** Whether an id names a real sandbox backend (i.e. not host / the 'none' pass-through). */
export function isActiveSandbox(provider: SandboxProviderId | undefined): provider is SandboxBackendId {
  return provider != null && provider !== 'none';
}

export const SANDBOX_BACKEND_IDS: readonly SandboxBackendId[] = ['nono', 'custom'];

export function isSandboxBackendId(value: unknown): value is SandboxBackendId {
  return typeof value === 'string' && (SANDBOX_BACKEND_IDS as readonly string[]).includes(value);
}

export const SANDBOX_PROVIDER_IDS: readonly SandboxProviderId[] = ['none', ...SANDBOX_BACKEND_IDS];

export function isSandboxProviderId(value: unknown): value is SandboxProviderId {
  return typeof value === 'string' && (SANDBOX_PROVIDER_IDS as readonly string[]).includes(value);
}

/** globalSettings key holding where a project runs things unless told otherwise. */
export function defaultSandboxSettingKey(projectPath: string): string {
  return `defaultSandbox:${projectPath}`;
}

/**
 * How much of the Ouijit API a sandboxed command may use: read its own task,
 * also move and rename it, or everything a host terminal can.
 */
export type SandboxCliAccess = 'read' | 'task' | 'all';

export function isSandboxCliAccess(value: unknown): value is SandboxCliAccess {
  return value === 'read' || value === 'task' || value === 'all';
}

export function sandboxCliAccessSettingKey(projectPath: string): string {
  return `sandboxCliAccess:${projectPath}`;
}

/** The lifecycle hooks that run in a task terminal of their own, so can run sandboxed. */
export const SANDBOXABLE_HOOK_TYPES: readonly string[] = ['start', 'continue', 'review', 'done'];

/** What each place a command can run is called, everywhere in the UI. */
export const SANDBOX_LABELS: Record<SandboxProviderId, string> = {
  none: 'Host',
  nono: 'Sandbox',
  custom: 'Custom',
};

/**
 * Subdirectories of a repo's `.git` that every sandbox backend grants writable
 * on top of an otherwise read-only `.git`, so commits land while `hooks/` and
 * `config` (the host-side RCE surface) stay unwritable. Single source of truth
 * for this security-sensitive overlay set — nono's `--write` flags and the
 * custom backend's `OUIJIT_SANDBOX_GIT_WRITABLE_DIRS` hint both derive from it
 * so the backends can't drift apart.
 */
export const GIT_WRITABLE_OVERLAY_DIRS = ['objects', 'refs', 'logs', 'worktrees'] as const;

/** Provider-neutral availability status surfaced to the UI. */
export interface SandboxProviderStatus {
  providerId: SandboxBackendId;
  /** Can spawn right now: installed and supported, or configured. */
  available: boolean;
  /** Provider-specific state label, or a reason string when unavailable
   *  (e.g. "Linux kernel 5.13+ required"). */
  detail?: string;
}

/** Context handed to a provider at spawn time to build its launch. */
export interface SandboxSpawnContext {
  projectPath: string;
  taskId?: number;
  /** Directory the PTY starts in (the task worktree for task terminals). */
  cwd: string;
  worktreePath?: string;
  /** Host hook-server port that must stay reachable from inside the sandbox. */
  apiPort: number;
}

/** A concrete process launch (post shell-integration) that a wrapper transforms. */
export interface SandboxLaunch {
  file: string;
  args: string[];
  env: Record<string, string>;
}

/** Where a terminal's foreground command runs right now; absent is the host. */
export interface TerminalSandboxPayload {
  ptyId: string;
  sandboxProvider?: SandboxProviderId;
}

/** The nono profile file a project's sandbox runs under. */
export interface NonoProfile {
  path: string;
  /** False when the user pointed the project at a file other than its own. */
  own: boolean;
}

/** A wrapper backend refused to spawn (`error`), or its launcher exited non-zero before the shell started. */
export interface SandboxLaunchFailedPayload {
  ptyId: string;
  provider: SandboxBackendId;
  exitCode?: number;
  error?: string;
}

/**
 * Persisted per-project configuration of the custom (bring-your-own) backend.
 * The command is the launcher Ouijit runs as `<command> -- <shell> [args]`;
 * it owns the sandbox boundary entirely.
 */
export interface CustomSandboxConfig {
  command?: string;
}
