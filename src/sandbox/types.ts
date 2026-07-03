/**
 * Cross-provider sandbox types.
 *
 * Pure leaf module — it imports nothing, so `src/types.ts` can re-export these
 * without creating a dependency cycle. The provider *interface* (which
 * references node-pty / electron types) lives in `./provider` and is used only
 * by main-process code.
 */

/** Identifies which sandbox backend runs a task's terminals and hooks. */
export type SandboxProviderId = 'none' | 'lima' | 'nono';

/** A registered backend id (everything except the pass-through 'none'). */
export type SandboxBackendId = Exclude<SandboxProviderId, 'none'>;

/** Provider-neutral availability / readiness status surfaced to the UI. */
export interface SandboxProviderStatus {
  providerId: SandboxBackendId;
  /** Binary present and platform supported. */
  available: boolean;
  /** Can spawn right now (Lima: VM Running; nono: same as `available`). */
  ready: boolean;
  /**
   * Provider-specific state label — Lima's vmStatus text, or a reason string
   * when unavailable (e.g. "Linux kernel 5.13+ required").
   */
  detail?: string;
}

/** What config surface a provider exposes, so the UI can feature-detect. */
export interface SandboxCapabilities {
  /** VM start / stop / recreate controls (Lima). */
  vmLifecycle: boolean;
  /** Raw YAML config editor (Lima). */
  yamlConfig: boolean;
  /** Dual-worktree sandbox-view branch namespace (Lima). */
  sandboxView: boolean;
  /** Named profile selection (nono). */
  profiles: boolean;
  /** Outbound network restriction controls (nono). */
  network: boolean;
}

/** Context handed to a wrapper provider at spawn time to build its launch. */
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

/** Persisted per-project nono configuration. */
export interface NonoConfig {
  /** Named nono profile (`--profile`); layered under the derived grants. */
  profile?: string;
  /** Deny outbound network (`--block-net`); the hook port stays open. */
  blockNet?: boolean;
  /** Extra localhost ports to open beyond the hook server. */
  openPorts?: number[];
}
