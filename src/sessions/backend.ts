/**
 * The live-process backend the session manager (#462) drives.
 *
 * The manager owns durable identity, the state machine, the buffer, and the
 * event stream; it knows nothing about how a process is actually spawned. That
 * is this interface's job. Keeping it abstract means the manager is unit-tested
 * against a fake backend (no node-pty, no Electron) and the production backend
 * ({@link ../sessions/nodePtyBackend}) can evolve — in-process node-pty today, a
 * detached daemon later — without touching the manager.
 */
import type { PtyId } from '../types';

/** Everything the backend needs to (re)spawn the live process for a session. */
export interface BackendSpawnInput {
  /** Working directory for the process. */
  cwd: string;
  /** Command to run; empty/undefined spawns a plain interactive shell. */
  command: string;
  /** Stable session id, exported into the process environment for hooks. */
  sessionId: string;
  taskId: number | null;
  worktreePath: string | null;
  sandboxed: boolean;
  cols: number;
  rows: number;
}

/** Callbacks the manager registers for a spawned process. */
export interface BackendHandlers {
  onData(data: string): void;
  onExit(exitCode: number | null): void;
}

/** Handle to one live process. Reassigned on every (re)spawn. */
export interface BackendPty {
  readonly ptyId: PtyId;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export interface SessionPtyBackend {
  spawn(input: BackendSpawnInput, handlers: BackendHandlers): BackendPty;
}
