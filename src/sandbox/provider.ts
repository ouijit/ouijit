import type { SandboxBackendId, SandboxLaunch, SandboxProviderStatus, SandboxSpawnContext } from './types';

/**
 * A sandbox backend transforms a host launch and nothing more: its PTYs run
 * through the host `ptyManager`, so reconnect, output coalescing, alt-screen
 * tracking and kill escalation are already handled and must not be
 * reimplemented here.
 */
export interface SandboxProvider {
  readonly id: SandboxBackendId;
  readonly displayName: string;
  /** Binary present and platform supported. */
  isAvailable(): Promise<boolean>;
  getStatus(projectPath: string): Promise<SandboxProviderStatus>;
  /** Verify availability and resolve cwd/env. Throws with a clear message when
   *  the backend can't run so the spawn fails loudly. */
  prepare(ctx: SandboxSpawnContext): Promise<{ cwd: string; env?: Record<string, string> }>;
  /** Transform the host launch at spawn time, once the grants it depends on
   *  (worktree, git dir, hook port) are known. */
  wrapLaunch(launch: SandboxLaunch, ctx: SandboxSpawnContext): Promise<SandboxLaunch>;
  /** App-quit cleanup; synchronous so it finishes before the process exits. */
  cleanup(): void;
}
