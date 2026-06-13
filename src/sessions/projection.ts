/**
 * Renderer projection of the authoritative SessionEvent stream (task #463).
 *
 * Pure, headless reducer: `(state, SessionEvent) -> state`. The main process owns
 * the truth ({@link ../sessions/model.SessionManagerApi}); the renderer is a
 * projection. This module folds the unified event stream into a flat, renderable
 * view of all sessions — no live handles, no IPC, no React, no globals — so the
 * core is unit-testable headless (the bonus called out in #463).
 *
 * It is the single place the renderer derives "what sessions exist and what
 * state each is in" from truth, replacing the old authoritative snapshot/restore
 * bookkeeping once #462 wires the emitter.
 */

import type { BufferCursor, SessionEvent, SessionId, SessionSnapshot } from './model';
import { canTransition } from './model';

/** Immutable projected view of all known sessions. */
export interface SessionProjection {
  /** Latest projected snapshot per session id. */
  readonly sessions: Readonly<Record<SessionId, SessionSnapshot>>;
  /** Session ids in creation order — the order the renderer lays terminals out. */
  readonly order: readonly SessionId[];
  /** Last output {@link BufferCursor} seen per session, for incremental tailing. */
  readonly cursors: Readonly<Record<SessionId, BufferCursor>>;
}

/** The starting (and post-reset) projection: no sessions. */
export const EMPTY_PROJECTION: SessionProjection = {
  sessions: {},
  order: [],
  cursors: {},
};

/**
 * Side-channel for non-fatal anomalies (events for unknown sessions, illegal
 * transitions). Injected rather than imported so the reducer stays pure and
 * testable without mocking a logger.
 */
export type ProjectionWarn = (message: string, meta: Record<string, unknown>) => void;

/**
 * Fold one {@link SessionEvent} into the projection. Returns the SAME reference
 * when the event is a no-op (unknown-session event, redundant state/cursor), so
 * callers can cheaply skip re-renders by identity.
 */
export function projectSession(
  state: SessionProjection,
  event: SessionEvent,
  warn?: ProjectionWarn,
): SessionProjection {
  switch (event.type) {
    case 'created': {
      const { session } = event;
      const exists = session.id in state.sessions;
      return {
        sessions: { ...state.sessions, [session.id]: session },
        // Re-`created` (e.g. rehydration after restart) keeps its slot; the
        // snapshot is refreshed in place rather than reordered.
        order: exists ? state.order : [...state.order, session.id],
        cursors: exists ? state.cursors : { ...state.cursors, [session.id]: 0 },
      };
    }

    case 'state-changed': {
      const current = state.sessions[event.id];
      if (!current) {
        warn?.('state-changed for unknown session', { id: event.id, to: event.state });
        return state;
      }
      if (!canTransition(current.state, event.state)) {
        warn?.('illegal session transition', { id: event.id, from: current.state, to: event.state });
      }
      if (current.state === event.state) return state;
      return {
        ...state,
        sessions: { ...state.sessions, [event.id]: { ...current, state: event.state } },
      };
    }

    case 'output': {
      if (!(event.id in state.sessions)) {
        warn?.('output for unknown session', { id: event.id });
        return state;
      }
      // The bytes themselves are fed to the terminal renderer as a side effect;
      // the projection only tracks the tail cursor.
      if (state.cursors[event.id] === event.cursor) return state;
      return { ...state, cursors: { ...state.cursors, [event.id]: event.cursor } };
    }

    case 'resized': {
      const current = state.sessions[event.id];
      if (!current) {
        warn?.('resized for unknown session', { id: event.id });
        return state;
      }
      if (current.cols === event.cols && current.rows === event.rows) return state;
      return {
        ...state,
        sessions: { ...state.sessions, [event.id]: { ...current, cols: event.cols, rows: event.rows } },
      };
    }

    case 'closed': {
      if (!(event.id in state.sessions)) {
        warn?.('closed for unknown session', { id: event.id });
        return state;
      }
      const { [event.id]: _removedSession, ...sessions } = state.sessions;
      const { [event.id]: _removedCursor, ...cursors } = state.cursors;
      return {
        sessions,
        order: state.order.filter((id) => id !== event.id),
        cursors,
      };
    }

    default: {
      // Exhaustiveness guard: a new SessionEvent kind must extend this reducer.
      const _exhaustive: never = event;
      void _exhaustive;
      return state;
    }
  }
}

/** Replay a batch of events onto `initial` — used for hydration and tests. */
export function reduceSessions(
  events: readonly SessionEvent[],
  initial: SessionProjection = EMPTY_PROJECTION,
  warn?: ProjectionWarn,
): SessionProjection {
  return events.reduce((acc, event) => projectSession(acc, event, warn), initial);
}

/** Snapshots in creation order — the renderer's terminal layout order. */
export function orderedSessions(state: SessionProjection): SessionSnapshot[] {
  const out: SessionSnapshot[] = [];
  for (const id of state.order) {
    const session = state.sessions[id];
    if (session) out.push(session);
  }
  return out;
}

/** Ordered snapshots scoped to a single project path. */
export function sessionsForProject(state: SessionProjection, projectPath: string): SessionSnapshot[] {
  return orderedSessions(state).filter((session) => session.projectPath === projectPath);
}
