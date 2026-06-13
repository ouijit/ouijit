/**
 * Durable session manager (task #462) — the main-process owner of sessions.
 *
 * Implements {@link SessionManagerApi} from the authoritative contract and adds
 * the lifecycle methods the IPC/CLI layers drive (spawn / write / resize /
 * close / rehydrate / persist). Durability is the whole point: identity, context
 * and scroll-back are persisted as {@link DurableSession} records so a session
 * survives a full app quit and is brought back live via {@link reattach}.
 *
 * The manager is deliberately free of node-pty and Electron imports. It talks to
 * the live process through an injected {@link SessionPtyBackend} and pushes the
 * {@link SessionEvent} stream through an injected emitter, so it unit-tests
 * against fakes and the production wiring lives in `./nodePtyBackend` + the
 * session IPC handler.
 */
import type {
  AttachResult,
  DurableSession,
  Session,
  SessionEvent,
  SessionId,
  SessionManagerApi,
  SessionSnapshot,
  SessionState,
  TerminalBuffer,
} from './model';
import { canTransition } from './model';
import { SessionBuffer, DEFAULT_MAX_BUFFER_SIZE } from './buffer';
import type { BackendPty, SessionPtyBackend } from './backend';
import { getLogger } from '../logger';

const sessionLog = getLogger().scope('sessions');

/** Persistence surface the manager needs (a subset of `db/repos/sessionRepo`). */
export interface SessionStore {
  upsert(session: DurableSession): void;
  upsertAll(sessions: DurableSession[]): void;
  getAll(): DurableSession[];
  delete(id: SessionId): void;
}

export type SessionEmit = (event: SessionEvent) => void;

/** Input for spawning a brand-new session. */
export interface SessionSpawnInput {
  /** Working directory for the process (defaults to `projectPath`). */
  cwd?: string;
  projectPath: string;
  command?: string;
  label?: string;
  taskId?: number | null;
  worktreePath?: string | null;
  sandboxed?: boolean;
  isRunner?: boolean;
  parentId?: SessionId | null;
  cols?: number;
  rows?: number;
}

export interface SessionManagerOptions {
  store: SessionStore;
  backend: SessionPtyBackend;
  emit: SessionEmit;
  maxBufferSize?: number;
  /** Override id generation (tests use a deterministic counter). */
  generateId?: () => SessionId;
}

/** Live session record plus the manager-private runtime fields. */
interface ManagedSession extends Session {
  buffer: SessionBuffer;
  live: BackendPty | null;
  /** Whether a renderer is currently bound (drives nothing today; see {@link detach}). */
  bound: boolean;
}

let idCounter = 0;
function defaultGenerateId(): SessionId {
  idCounter += 1;
  return `session-${Date.now()}-${idCounter.toString(36)}`;
}

export class SessionManager implements SessionManagerApi {
  private sessions = new Map<SessionId, ManagedSession>();
  private readonly store: SessionStore;
  private readonly backend: SessionPtyBackend;
  private readonly emit: SessionEmit;
  private readonly maxBufferSize: number;
  private readonly genId: () => SessionId;

  constructor(opts: SessionManagerOptions) {
    this.store = opts.store;
    this.backend = opts.backend;
    this.emit = opts.emit;
    this.maxBufferSize = opts.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE;
    this.genId = opts.generateId ?? defaultGenerateId;
  }

  // ── SessionManagerApi ──────────────────────────────────────────────

  list(): SessionSnapshot[] {
    return Array.from(this.sessions.values()).map(toSnapshot);
  }

  get(id: SessionId): SessionSnapshot | null {
    const session = this.sessions.get(id);
    return session ? toSnapshot(session) : null;
  }

  attach(id: SessionId): AttachResult | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    session.bound = true;
    return toAttachResult(session);
  }

  detach(id: SessionId): void {
    const session = this.sessions.get(id);
    if (!session) return;
    // Detach unbinds the renderer but never kills the process: the session
    // keeps running headless and buffering for a later attach/reattach.
    session.bound = false;
  }

  async reattach(id: SessionId): Promise<AttachResult> {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session ${id} not found`);

    // Already live — reattach is a no-op beyond rebinding and returning replay.
    if (session.live) {
      session.bound = true;
      return toAttachResult(session);
    }

    this.spawnInto(session);
    this.setState(session, 'running');
    session.bound = true;
    return toAttachResult(session);
  }

  readBuffer(id: SessionId): TerminalBuffer | null {
    return this.sessions.get(id)?.buffer ?? null;
  }

  // ── Lifecycle (driven by IPC/CLI wiring) ───────────────────────────

  /** Create and start a brand-new session. */
  spawn(input: SessionSpawnInput): AttachResult {
    const id = this.genId();
    const cols = input.cols ?? 80;
    const rows = input.rows ?? 24;
    const session: ManagedSession = {
      id,
      state: 'idle',
      ptyHandle: null,
      buffer: new SessionBuffer(this.maxBufferSize),
      taskId: input.taskId ?? null,
      worktreePath: input.worktreePath ?? null,
      label: input.label ?? input.command ?? 'Shell',
      projectPath: input.projectPath,
      command: input.command ?? '',
      sandboxed: input.sandboxed ?? false,
      isRunner: input.isRunner ?? false,
      parentId: input.parentId ?? null,
      cols,
      rows,
      createdAt: new Date().toISOString(),
      live: null,
      bound: true,
    };
    this.sessions.set(id, session);

    this.spawnInto(session);
    this.persist(session);
    this.emit({ type: 'created', session: toSnapshot(session) });
    // Move idle → running now that a process backs it.
    this.setState(session, 'running');

    return toAttachResult(session);
  }

  write(id: SessionId, data: string): void {
    this.sessions.get(id)?.live?.write(data);
  }

  resize(id: SessionId, cols: number, rows: number): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.cols = cols;
    session.rows = rows;
    session.live?.resize(cols, rows);
    this.emit({ type: 'resized', id, cols, rows });
  }

  /**
   * Explicitly advance the state machine (e.g. a shell-integration signal moved
   * a running session to `ready` or `awaiting`). Rejects illegal transitions.
   */
  setState(session: ManagedSession | SessionId, to: SessionState): boolean {
    const s = typeof session === 'string' ? this.sessions.get(session) : session;
    if (!s) return false;
    const from = s.state;
    if (from === to) return true;
    if (!canTransition(from, to)) {
      sessionLog.warn('rejected illegal transition', { id: s.id, from, to });
      return false;
    }
    s.state = to;
    this.persist(s);
    this.emit({ type: 'state-changed', id: s.id, prev: from, state: to });
    return true;
  }

  /** Kill the process and remove the session, emitting `closed`. */
  close(id: SessionId): void {
    const session = this.sessions.get(id);
    if (!session) return;
    if (session.live) {
      try {
        session.live.kill();
      } catch (error) {
        sessionLog.warn('kill failed during close', {
          id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    session.live = null;
    session.ptyHandle = null;
    this.sessions.delete(id);
    this.store.delete(id);
    // Forced kill — no exit code available.
    this.emit({ type: 'closed', id, exitCode: null });
  }

  /**
   * Rehydrate dormant sessions from the store on launch. The live PTY cannot
   * survive a quit, so every rehydrated session comes back DORMANT (no process,
   * `ptyHandle: null`); its retained state is kept only as a UI hint and reset to
   * `idle` so {@link reattach} can cleanly bring it back. Returns the count.
   */
  rehydrate(): number {
    const durable = this.store.getAll();
    for (const record of durable) {
      if (this.sessions.has(record.id)) continue;
      const session: ManagedSession = {
        id: record.id,
        // Dormant after a restart: no process survives, so we land on `idle`.
        // `lastState` is preserved on the record purely as a UI hint.
        state: 'idle',
        ptyHandle: null,
        buffer: SessionBuffer.fromDurable(record.buffer, this.maxBufferSize),
        taskId: record.taskId,
        worktreePath: record.worktreePath,
        label: record.label,
        projectPath: record.projectPath,
        command: record.command,
        sandboxed: record.sandboxed,
        isRunner: record.isRunner,
        parentId: record.parentId,
        cols: record.cols,
        rows: record.rows,
        createdAt: record.createdAt,
        live: null,
        bound: false,
      };
      this.sessions.set(record.id, session);
    }
    sessionLog.info('rehydrated sessions', { count: durable.length });
    return durable.length;
  }

  /** Persist all known sessions (called at quit, before processes are torn down). */
  persistAll(): void {
    this.store.upsertAll(Array.from(this.sessions.values()).map(toDurable));
  }

  // ── internals ──────────────────────────────────────────────────────

  private persist(session: ManagedSession): void {
    try {
      this.store.upsert(toDurable(session));
    } catch (error) {
      sessionLog.error('persist failed', {
        id: session.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Spawn the live process for a session and wire its output/exit handlers. */
  private spawnInto(session: ManagedSession): void {
    const live = this.backend.spawn(
      {
        cwd: session.worktreePath ?? session.projectPath,
        command: session.command,
        sessionId: session.id,
        taskId: session.taskId,
        worktreePath: session.worktreePath,
        sandboxed: session.sandboxed,
        cols: session.cols,
        rows: session.rows,
      },
      {
        onData: (data) => this.handleData(session.id, data),
        onExit: (exitCode) => this.handleExit(session.id, exitCode),
      },
    );
    session.live = live;
    session.ptyHandle = live.ptyId;
  }

  private handleData(id: SessionId, data: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.buffer.append(data);
    this.emit({ type: 'output', id, data, cursor: session.buffer.cursor });
  }

  private handleExit(id: SessionId, exitCode: number | null): void {
    const session = this.sessions.get(id);
    if (!session) return;
    // The process is gone; the session goes dormant but is retained so the user
    // can reattach (rerun). A clean exit lands on `idle`, a failure on `error`.
    session.live = null;
    session.ptyHandle = null;
    const next: SessionState = exitCode === 0 || exitCode === null ? 'idle' : 'error';
    if (!this.setState(session, next)) {
      // Already in `next`; still persist the now-dormant record.
      this.persist(session);
    }
  }
}

// ── pure mappers ─────────────────────────────────────────────────────

function toSnapshot(session: ManagedSession): SessionSnapshot {
  return {
    id: session.id,
    state: session.state,
    taskId: session.taskId,
    worktreePath: session.worktreePath,
    label: session.label,
    projectPath: session.projectPath,
    isRunner: session.isRunner,
    parentId: session.parentId,
    sandboxed: session.sandboxed,
    cols: session.cols,
    rows: session.rows,
    isAltScreen: session.buffer.isAltScreen,
    createdAt: session.createdAt,
    attached: session.live !== null,
  };
}

function toAttachResult(session: ManagedSession): AttachResult {
  return {
    session: toSnapshot(session),
    replay: session.buffer.readAll(),
    cursor: session.buffer.cursor,
    isAltScreen: session.buffer.isAltScreen,
    cols: session.cols,
    rows: session.rows,
  };
}

function toDurable(session: ManagedSession): DurableSession {
  return {
    id: session.id,
    lastState: session.state,
    taskId: session.taskId,
    worktreePath: session.worktreePath,
    label: session.label,
    projectPath: session.projectPath,
    command: session.command,
    sandboxed: session.sandboxed,
    isRunner: session.isRunner,
    parentId: session.parentId,
    createdAt: session.createdAt,
    buffer: session.buffer.toDurable(),
    cols: session.cols,
    rows: session.rows,
  };
}
