import type { BrowserWindow } from 'electron';
import type { PtySpawnOptions, PtySpawnResult, PtyReconnectResult, ActiveSession, PtyId } from '../types';
import type {
  SandboxBackendId,
  SandboxCapabilities,
  SandboxLaunch,
  SandboxProviderStatus,
  SandboxSpawnContext,
} from './types';

/**
 * Common surface every sandbox backend implements. Backends come in two kinds
 * (below); `pty.ts` dispatches to them via the registry instead of hardcoding
 * Lima.
 */
interface SandboxProviderBase {
  readonly id: SandboxBackendId;
  readonly displayName: string;
  readonly capabilities: SandboxCapabilities;
  /** Binary present and platform supported. */
  isAvailable(): Promise<boolean>;
  getStatus(projectPath: string): Promise<SandboxProviderStatus>;
  /**
   * Optional per-task teardown on worktree deletion (Lima stops its dual
   * sandbox-view worktree). Providers with no per-task resources omit it.
   */
  cleanupTaskResources?(projectPath: string, taskNumber: number, branch: string): Promise<void>;
  /** App-quit cleanup; synchronous so it finishes before the process exits. */
  cleanup(): void;
}

/**
 * A backend that owns its PTY sessions end to end. Lima must: it spawns
 * `limactl`, keeps its own session map, swaps cwd to a sandbox-view worktree,
 * re-exports env inside the VM, and runs a ref-watcher — none of which fit the
 * host spawn path. Per-PTY ops route here when `ownsPty(ptyId)` is true.
 */
export interface SessionOwnerSandboxProvider extends SandboxProviderBase {
  readonly kind: 'session-owner';
  spawnPty(options: PtySpawnOptions, window: BrowserWindow): Promise<PtySpawnResult>;
  ownsPty(ptyId: PtyId): boolean;
  writePty(ptyId: PtyId, data: string): void;
  resizePty(ptyId: PtyId, cols: number, rows: number): void;
  killPty(ptyId: PtyId): void;
  setPtyLabel(ptyId: PtyId, label: string): void;
  getActiveSessions(): ActiveSession[];
  reconnectPty(ptyId: PtyId, window: BrowserWindow): PtyReconnectResult;
}

/**
 * A backend that only transforms a host launch — nono prefixes its own argv,
 * the custom backend a project-supplied launcher. Its PTYs flow through the
 * host `ptyManager`, so they reuse all of its session machinery (reconnect,
 * output coalescing, alt-screen tracking, kill escalation) for free.
 */
export interface WrapperSandboxProvider extends SandboxProviderBase {
  readonly kind: 'wrapper';
  /** Verify availability and resolve cwd/env. Throws with a clear message when
   *  the backend can't run so the spawn fails loudly. */
  prepare(ctx: SandboxSpawnContext): Promise<{ cwd: string; env?: Record<string, string> }>;
  /** Transform the host launch at spawn time, once the grants it depends on
   *  (worktree, git dir, hook port) are known. */
  wrapLaunch(launch: SandboxLaunch, ctx: SandboxSpawnContext): Promise<SandboxLaunch>;
}

export type SandboxProvider = SessionOwnerSandboxProvider | WrapperSandboxProvider;
