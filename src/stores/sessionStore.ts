/**
 * Session projection store (task #463).
 *
 * The renderer's derived view of the authoritative session stream. It holds NO
 * authoritative state of its own — every field is folded from the main-process
 * {@link SessionEvent} stream through the pure reducer in
 * `../sessions/projection`. Reload becomes re-subscribe + re-hydrate from truth,
 * which is what dissolves the old snapshot/restore machinery.
 *
 * `connectSessionProjection` is the seam that binds this store to truth; it is
 * intentionally NOT auto-invoked yet (see its doc) because the emitter ships
 * with #462. Until then the reducer and store are exercised headlessly in tests.
 */

import { create } from 'zustand';
import log from 'electron-log/renderer';
import '../sessions/rendererApi';
import type { SessionEvent, SessionId, SessionSnapshot } from '../sessions/model';
import {
  EMPTY_PROJECTION,
  orderedSessions,
  projectSession,
  sessionsForProject,
  type SessionProjection,
} from '../sessions/projection';

const sessionLog = log.scope('sessionProjection');

const warn = (message: string, meta: Record<string, unknown>): void => sessionLog.warn(message, meta);

interface SessionStoreState extends SessionProjection {
  /** True while subscribed to the main-process session stream. */
  connected: boolean;
}

interface SessionStoreActions {
  /** Fold one event from the authoritative stream into the projection. */
  apply: (event: SessionEvent) => void;
  /** Full resync from a snapshot list (initial hydrate or recovery). */
  hydrate: (snapshots: SessionSnapshot[]) => void;
  setConnected: (connected: boolean) => void;
  /** Drop all projected state (e.g. on disconnect). */
  reset: () => void;
}

export const useSessionStore = create<SessionStoreState & SessionStoreActions>()((set, get) => ({
  ...EMPTY_PROJECTION,
  connected: false,

  apply: (event) => {
    const { sessions, order, cursors } = get();
    const prev: SessionProjection = { sessions, order, cursors };
    const next = projectSession(prev, event, warn);
    // projectSession returns the same references on a no-op — skip the set.
    if (next.sessions !== sessions || next.order !== order || next.cursors !== cursors) {
      set(next);
    }
  },

  hydrate: (snapshots) => {
    const next = snapshots.reduce<SessionProjection>(
      (acc, session) => projectSession(acc, { type: 'created', session }, warn),
      EMPTY_PROJECTION,
    );
    set(next);
  },

  setConnected: (connected) => set({ connected }),

  reset: () => set({ ...EMPTY_PROJECTION, connected: false }),
}));

// ── Selectors ──────────────────────────────────────────────────────────

/** All sessions in creation order. */
export function selectOrderedSessions(state: SessionStoreState): SessionSnapshot[] {
  return orderedSessions(state);
}

/** A selector bound to one project path, for `useSessionStore(selectSessionsForProject(p))`. */
export function selectSessionsForProject(projectPath: string): (state: SessionStoreState) => SessionSnapshot[] {
  return (state) => sessionsForProject(state, projectPath);
}

/** One session snapshot by id, or undefined if not projected. */
export function getSession(id: SessionId): SessionSnapshot | undefined {
  return useSessionStore.getState().sessions[id];
}

// ── Connection to the authoritative stream ──────────────────────────────

/**
 * Subscribe the projection store to the main-process {@link SessionEvent} stream
 * and hydrate from the current session list. Returns an unsubscribe fn.
 *
 * Subscribes BEFORE listing so no event emitted during the `list()` round-trip
 * is dropped; the list then fills in any session not yet seen live.
 *
 * Not auto-invoked: App.tsx wires this in the follow-on slice that converts the
 * terminal stores from authoritative to derived. Calling it before #462 wires
 * the emitter would gain nothing — `session:list` would simply reject (logged,
 * non-fatal) and the projection would stay empty.
 */
export async function connectSessionProjection(): Promise<() => void> {
  const { apply, setConnected } = useSessionStore.getState();
  const unsubscribe = window.api.sessions.onEvent(apply);
  try {
    const snapshots = await window.api.sessions.list();
    for (const session of snapshots) {
      if (!(session.id in useSessionStore.getState().sessions)) {
        apply({ type: 'created', session });
      }
    }
  } catch (err) {
    sessionLog.warn('session list hydrate failed (emitter not wired yet?)', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  setConnected(true);
  return () => {
    unsubscribe();
    useSessionStore.getState().setConnected(false);
  };
}
