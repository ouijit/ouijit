/**
 * Authoritative Session model — the durability-first firewall (task #460).
 *
 * The main process owns sessions. This module is the single contract that the
 * three follow-on tracks build against:
 *   - #461 renderer port      — reads {@link SessionSnapshot} / {@link TerminalBuffer}
 *   - #462 durable sessions   — implements {@link SessionManagerApi} + persists {@link DurableSession}
 *   - #463 renderer projection — consumes the {@link SessionEvent} stream
 *
 * See ./DESIGN.md for the rationale, the state-machine diagram, and the mapping
 * to today's `ptyManager.ts` (ManagedPty / ActiveSession).
 *
 * Durability requirements baked into this contract (hard to retrofit later):
 *   1. Session ids are STABLE and survive a full app restart — distinct from
 *      the ephemeral live-process id ({@link PtyId}), which is reassigned on
 *      every (re)spawn.
 *   2. The persisted shape ({@link DurableSession}) is JSON-serializable: no
 *      live handles, no functions, no class instances — so a session can be
 *      written to disk and rehydrated after a full quit.
 *   3. A session can DETACH from the renderer (renderer reload, card closed)
 *      and keep running, AND outlive the app process. The live PTY cannot
 *      survive a quit, so on restart a session rehydrates DORMANT (no process)
 *      and is brought back via {@link SessionManagerApi.reattach}.
 *
 * No behavior change ships with this file — it is the shape the tracks fill in.
 */

import type { PtyId } from '../types';

/**
 * Durable session identity. Stable across renderer reloads AND full app
 * restarts. This is NOT the {@link PtyId}: a {@link PtyId} identifies the live
 * PTY process and is reassigned every time the process is (re)spawned, whereas
 * a `SessionId` is allocated once and persisted for the life of the session.
 */
export type SessionId = string;

/**
 * The session state machine. Exactly the five states the renderer renders.
 *
 *   idle     — no live process backing the session: never started, exited
 *              cleanly, or rehydrated-but-dormant after a restart.
 *   running  — a live process is actively executing / producing output.
 *   awaiting — a live process is blocked on user input (agent question, a
 *              `read`, a pager) and will not progress until the user responds.
 *   ready    — a live process is idle at an interactive prompt, ready for the
 *              next command (shell prompt, OSC 133 'D' seen).
 *   error    — the process exited non-zero or crashed; the record is retained
 *              so the renderer can surface the failure until it is cleared.
 *
 * Clean process exit moves a session to `idle` (or it is removed entirely and a
 * `closed` event is emitted). `closed` is a lifecycle event, not a state — a
 * closed session no longer exists.
 */
export type SessionState = 'idle' | 'running' | 'awaiting' | 'ready' | 'error';

/**
 * Allowed forward transitions for {@link SessionState}. Authoritative table the
 * manager (#462) validates against and the projection (#463) can assert with.
 */
export const SESSION_STATE_TRANSITIONS: Record<SessionState, readonly SessionState[]> = {
  idle: ['running'],
  running: ['ready', 'awaiting', 'error', 'idle'],
  awaiting: ['running', 'ready', 'error', 'idle'],
  ready: ['running', 'awaiting', 'error', 'idle'],
  // `error` and a dormant `idle` both clear when the session is (re)spawned.
  error: ['idle', 'running'],
} as const;

/** Whether a state transition is permitted by {@link SESSION_STATE_TRANSITIONS}. */
export function canTransition(from: SessionState, to: SessionState): boolean {
  return from === to || SESSION_STATE_TRANSITIONS[from].includes(to);
}

/**
 * A monotonic byte offset into a session's output stream. Used to read output
 * incrementally ({@link TerminalBuffer.readSince}) so the projection (#463) can
 * tail without re-replaying the whole buffer.
 */
export type BufferCursor = number;

/**
 * Read-only view of a session's terminal output buffer — the single interface
 * the renderer port (#461) and the projection (#463) both read through, so they
 * agree on replay semantics. The concrete buffer (ring buffer, file-backed,
 * etc.) is an implementation detail of #462.
 */
export interface TerminalBuffer {
  /** Full retained scroll-back, concatenated, for an initial replay. */
  readAll(): string;
  /**
   * Output appended since `cursor`. Returns the slice plus the cursor to pass
   * next time. If `cursor` is older than the retained window, returns whatever
   * is still retained from the earliest available point.
   */
  readSince(cursor: BufferCursor): { data: string; cursor: BufferCursor };
  /** The current end cursor, without reading — use to start a live tail. */
  readonly cursor: BufferCursor;
  /** Total retained byte length (may be less than total ever written if trimmed). */
  readonly byteLength: number;
  /**
   * Whether the terminal is currently in alternate-screen (TUI) mode, which
   * changes how a replay must be rendered.
   */
  readonly isAltScreen: boolean;
}

/**
 * Pointer to a session's persisted output buffer. Kept out of the
 * {@link DurableSession} JSON body so a large scroll-back need not be inlined
 * into the record. #462 chooses the representation.
 */
export type DurableBufferRef =
  | { kind: 'inline'; chunks: string[] }
  | { kind: 'file'; path: string; byteLength: number };

/**
 * Live, in-memory session owned by the main process. Superset of the durable
 * record plus the runtime-only handles that cannot cross the IPC boundary or be
 * serialized ({@link ptyHandle}, {@link buffer}). The renderer never receives
 * this object — only a {@link SessionSnapshot}.
 */
export interface Session {
  readonly id: SessionId;
  state: SessionState;
  /**
   * Live PTY backing this session, or `null` when detached/dormant (after a
   * restart, before {@link SessionManagerApi.reattach}). Ephemeral — changes on
   * every (re)spawn; never persisted.
   */
  ptyHandle: PtyId | null;
  /** Live output buffer. Read through {@link TerminalBuffer}; persisted as {@link DurableBufferRef}. */
  readonly buffer: TerminalBuffer;
  taskId: number | null;
  worktreePath: string | null;
  label: string;
  // Context required to respawn the session after a restart:
  projectPath: string;
  command: string;
  sandboxed: boolean;
  /** Secondary "run a command" terminal attached to a parent session. */
  isRunner: boolean;
  /** Parent session for a runner, by STABLE id (not PtyId). */
  parentId: SessionId | null;
  cols: number;
  rows: number;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
}

/**
 * JSON-serializable persisted form of a session, written to disk so the session
 * survives a full app quit. EXCLUDES the live {@link Session.ptyHandle} and the
 * in-memory {@link Session.buffer} object — the process cannot outlive the app,
 * and the buffer is referenced via {@link DurableBufferRef}. On restart this
 * rehydrates into a dormant {@link Session} (`ptyHandle: null`, `state: 'idle'`).
 *
 * Every field here must be a JSON primitive, array, or plain object: no
 * functions, no class instances, no live handles.
 */
export interface DurableSession {
  id: SessionId;
  /**
   * State at persist time. Restored sessions reset to `idle` (no process
   * survives a quit); this is retained only as a UI hint (e.g. surface a prior
   * `error` after restart).
   */
  lastState: SessionState;
  taskId: number | null;
  worktreePath: string | null;
  label: string;
  projectPath: string;
  command: string;
  sandboxed: boolean;
  isRunner: boolean;
  parentId: SessionId | null;
  createdAt: string;
  /** Pointer to the persisted output buffer for replay on reattach. */
  buffer: DurableBufferRef;
  /** Terminal geometry at persist time, for accurate replay. */
  cols: number;
  rows: number;
}

/**
 * Immutable, serializable description of a session as the renderer sees it.
 * This is what crosses the IPC boundary — never the live {@link Session}. It
 * carries no buffer payload; the buffer is fetched via {@link AttachResult} or
 * streamed via {@link SessionEvent} `output`.
 */
export interface SessionSnapshot {
  id: SessionId;
  state: SessionState;
  taskId: number | null;
  worktreePath: string | null;
  label: string;
  projectPath: string;
  isRunner: boolean;
  parentId: SessionId | null;
  sandboxed: boolean;
  cols: number;
  rows: number;
  isAltScreen: boolean;
  createdAt: string;
  /**
   * `true` when a live process currently backs the session; `false` when
   * dormant (detached across a restart, awaiting {@link SessionManagerApi.reattach}).
   */
  attached: boolean;
}

/**
 * The unified event stream main emits to the renderer. One discriminated union
 * carried on a single push channel (`session:event`) so ordering across event
 * kinds is preserved per session.
 *
 *   created       — a session entered the manager (spawn, or rehydration after restart).
 *   state-changed — the {@link SessionState} machine advanced.
 *   output        — new terminal bytes were appended; `cursor` is the new end.
 *   resized       — the PTY geometry changed.
 *   closed        — the session was removed; `exitCode` is null on a forced kill.
 */
export type SessionEvent =
  | { type: 'created'; session: SessionSnapshot }
  | { type: 'state-changed'; id: SessionId; prev: SessionState; state: SessionState }
  | { type: 'output'; id: SessionId; data: string; cursor: BufferCursor }
  | { type: 'resized'; id: SessionId; cols: number; rows: number }
  | { type: 'closed'; id: SessionId; exitCode: number | null };

/**
 * Result of attaching to (or reattaching) a session: the current snapshot plus
 * everything needed to paint a fresh terminal view and start a live tail.
 */
export interface AttachResult {
  session: SessionSnapshot;
  /** Full retained buffer to replay into the freshly mounted terminal. */
  replay: string;
  /** Cursor at the end of `replay` — pass to follow-on incremental reads. */
  cursor: BufferCursor;
  isAltScreen: boolean;
  cols: number;
  rows: number;
}

/**
 * Main-process session manager surface. The owner of #462 implements this; the
 * renderer reaches it over the {@link SessionInvokeContract} channels.
 *
 * Detach vs. close is the durability-critical distinction:
 *   - `detach` keeps the process alive and buffering headlessly (renderer
 *     reload, card closed but work continues).
 *   - closing a session kills the process and emits a `closed` event.
 */
export interface SessionManagerApi {
  /** All sessions known to main, live or dormant. */
  list(): SessionSnapshot[];
  get(id: SessionId): SessionSnapshot | null;
  /**
   * Bind the renderer to a session and get its buffer for replay. Pure
   * read/subscribe — does NOT spawn. A dormant (post-restart) session returns
   * its persisted buffer with `attached: false`; call {@link reattach} to bring
   * the process back.
   */
  attach(id: SessionId): AttachResult | null;
  /**
   * Detach the renderer WITHOUT killing the process. The session keeps running
   * headless and buffering output for a later attach/reattach.
   */
  detach(id: SessionId): void;
  /**
   * Re-bind a dormant session to a freshly spawned PTY, restoring its identity,
   * context, and replay buffer. Advances state `idle → running`.
   */
  reattach(id: SessionId): Promise<AttachResult>;
  /** The read-only buffer view, shared by the renderer port and the projection. */
  readBuffer(id: SessionId): TerminalBuffer | null;
}

/**
 * Renderer→main request/response channels for the session API. Composed into
 * `IpcInvokeContract` (see ipc/contract.ts). Handlers are wired by #462; until
 * then these are type-only and emit nothing.
 */
export interface SessionInvokeContract {
  'session:list': { args: []; return: SessionSnapshot[] };
  'session:get': { args: [id: SessionId]; return: SessionSnapshot | null };
  'session:attach': { args: [id: SessionId]; return: AttachResult | null };
  'session:detach': { args: [id: SessionId]; return: void };
  'session:reattach': { args: [id: SessionId]; return: AttachResult | null };
}

/**
 * main→renderer push channel carrying the unified {@link SessionEvent} stream.
 * Composed into `IpcPushContract` (see ipc/contract.ts).
 */
export interface SessionPushContract {
  'session:event': { args: [event: SessionEvent] };
}

/**
 * Proposed preload-exposed renderer surface for sessions (the #461 port grafts
 * this onto `ElectronAPI`). Kept here as the agreed shape; not yet wired into
 * the live `window.api`, so no behavior changes.
 */
export interface SessionsAPI {
  list(): Promise<SessionSnapshot[]>;
  get(id: SessionId): Promise<SessionSnapshot | null>;
  attach(id: SessionId): Promise<AttachResult | null>;
  detach(id: SessionId): Promise<void>;
  reattach(id: SessionId): Promise<AttachResult | null>;
  /** Subscribe to the unified session event stream. Returns an unsubscribe fn. */
  onEvent(callback: (event: SessionEvent) => void): () => void;
}
