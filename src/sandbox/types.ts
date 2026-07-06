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

/**
 * Map the legacy per-terminal "open in sandbox" boolean to a provider id. Older
 * snapshots and the hook-run toggle only recorded a boolean, which always meant
 * the Lima backend; new code records `sandboxProvider` directly. Single source
 * of the boolean→id translation so the deserialization boundaries can't drift.
 */
export function legacySandboxProvider(sandboxed: boolean | undefined): SandboxProviderId | undefined {
  return sandboxed ? 'lima' : undefined;
}

/** Whether an id names a real sandbox backend (i.e. not host / the 'none' pass-through). */
export function isActiveSandbox(provider: SandboxProviderId | undefined): provider is SandboxBackendId {
  return provider != null && provider !== 'none';
}

/** Display label for each sandbox backend, shared across every UI surface. */
export const SANDBOX_BACKEND_LABELS: Record<SandboxBackendId, string> = {
  lima: 'Lima VM',
  nono: 'nono',
};

/**
 * Subdirectories of a repo's `.git` that every sandbox backend grants writable
 * on top of an otherwise read-only `.git`, so commits land while `hooks/` and
 * `config` (the host-side RCE surface) stay unwritable. Single source of truth
 * for this security-sensitive overlay set — Lima's mounts and nono's `--write`
 * flags derive from it so the two backends can't drift apart.
 */
export const GIT_WRITABLE_OVERLAY_DIRS = ['objects', 'refs', 'logs', 'worktrees'] as const;

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
  /** Deny outbound network (`--block-net`); the hook port stays open. */
  blockNet?: boolean;
  /** Extra localhost ports to open beyond the hook server. */
  openPorts?: number[];
  /** Extra folders granted read+write beyond the derived worktree + git grants. */
  allowPaths?: string[];
  /**
   * Full escape hatch: a raw nono profile (JSON text) that replaces Ouijit's
   * managed `ouijit` profile for this project. Peer to Lima's YAML editor —
   * the developer owns the sandbox policy. Blank/absent means the managed
   * profile is used. Ouijit still layers the per-task grants (worktree, git,
   * hook port, caches) on top at spawn time regardless of what this contains.
   */
  profile?: string;
}
