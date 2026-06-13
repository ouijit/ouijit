import { describe, test, expect, vi } from 'vitest';
import {
  EMPTY_PROJECTION,
  orderedSessions,
  projectSession,
  reduceSessions,
  sessionsForProject,
  type SessionProjection,
} from '../sessions/projection';
import type { SessionEvent, SessionSnapshot } from '../sessions/model';

function snapshot(id: string, patch: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    id,
    state: 'idle',
    taskId: null,
    worktreePath: null,
    label: id,
    projectPath: '/proj',
    isRunner: false,
    parentId: null,
    sandboxed: false,
    cols: 80,
    rows: 24,
    isAltScreen: false,
    createdAt: '2026-06-13T00:00:00.000Z',
    attached: true,
    ...patch,
  };
}

const created = (s: SessionSnapshot): SessionEvent => ({ type: 'created', session: s });

describe('projectSession — created', () => {
  test('adds a session, appends to order, seeds cursor 0', () => {
    const next = projectSession(EMPTY_PROJECTION, created(snapshot('a')));
    expect(next.order).toEqual(['a']);
    expect(next.sessions.a.label).toBe('a');
    expect(next.cursors.a).toBe(0);
  });

  test('preserves order across multiple creates', () => {
    const next = reduceSessions([created(snapshot('a')), created(snapshot('b')), created(snapshot('c'))]);
    expect(next.order).toEqual(['a', 'b', 'c']);
  });

  test('re-created session refreshes snapshot in place without reordering or resetting cursor', () => {
    let state = reduceSessions([created(snapshot('a')), created(snapshot('b'))]);
    state = projectSession(state, { type: 'output', id: 'a', data: 'x', cursor: 42 });
    const next = projectSession(state, created(snapshot('a', { label: 'renamed' })));
    expect(next.order).toEqual(['a', 'b']);
    expect(next.sessions.a.label).toBe('renamed');
    expect(next.cursors.a).toBe(42); // cursor not reset on re-create
  });
});

describe('projectSession — state-changed', () => {
  test('advances state on a known session', () => {
    const state = reduceSessions([created(snapshot('a', { state: 'idle' }))]);
    const next = projectSession(state, { type: 'state-changed', id: 'a', prev: 'idle', state: 'running' });
    expect(next.sessions.a.state).toBe('running');
  });

  test('redundant state change is a no-op (same reference)', () => {
    const state = reduceSessions([created(snapshot('a', { state: 'running' }))]);
    const next = projectSession(state, { type: 'state-changed', id: 'a', prev: 'running', state: 'running' });
    expect(next).toBe(state);
  });

  test('illegal transition still applies but warns', () => {
    const warn = vi.fn();
    const state = reduceSessions([created(snapshot('a', { state: 'idle' }))]);
    // idle -> awaiting is not in SESSION_STATE_TRANSITIONS
    const next = projectSession(state, { type: 'state-changed', id: 'a', prev: 'idle', state: 'awaiting' }, warn);
    expect(next.sessions.a.state).toBe('awaiting');
    expect(warn).toHaveBeenCalledWith('illegal session transition', { id: 'a', from: 'idle', to: 'awaiting' });
  });

  test('unknown session is ignored and warns', () => {
    const warn = vi.fn();
    const next = projectSession(
      EMPTY_PROJECTION,
      { type: 'state-changed', id: 'ghost', prev: 'idle', state: 'running' },
      warn,
    );
    expect(next).toBe(EMPTY_PROJECTION);
    expect(warn).toHaveBeenCalledWith('state-changed for unknown session', { id: 'ghost', to: 'running' });
  });
});

describe('projectSession — output', () => {
  test('advances the cursor', () => {
    const state = reduceSessions([created(snapshot('a'))]);
    const next = projectSession(state, { type: 'output', id: 'a', data: 'hi', cursor: 10 });
    expect(next.cursors.a).toBe(10);
    // snapshot identity unchanged — output does not touch the snapshot map
    expect(next.sessions).toBe(state.sessions);
  });

  test('redundant cursor is a no-op', () => {
    let state = reduceSessions([created(snapshot('a'))]);
    state = projectSession(state, { type: 'output', id: 'a', data: 'hi', cursor: 10 });
    const next = projectSession(state, { type: 'output', id: 'a', data: '', cursor: 10 });
    expect(next).toBe(state);
  });

  test('output for unknown session is ignored', () => {
    const warn = vi.fn();
    const next = projectSession(EMPTY_PROJECTION, { type: 'output', id: 'ghost', data: 'x', cursor: 1 }, warn);
    expect(next).toBe(EMPTY_PROJECTION);
    expect(warn).toHaveBeenCalled();
  });
});

describe('projectSession — resized', () => {
  test('updates geometry', () => {
    const state = reduceSessions([created(snapshot('a'))]);
    const next = projectSession(state, { type: 'resized', id: 'a', cols: 120, rows: 40 });
    expect(next.sessions.a.cols).toBe(120);
    expect(next.sessions.a.rows).toBe(40);
  });

  test('redundant resize is a no-op', () => {
    const state = reduceSessions([created(snapshot('a', { cols: 80, rows: 24 }))]);
    const next = projectSession(state, { type: 'resized', id: 'a', cols: 80, rows: 24 });
    expect(next).toBe(state);
  });
});

describe('projectSession — closed', () => {
  test('removes the session from every map', () => {
    let state = reduceSessions([created(snapshot('a')), created(snapshot('b'))]);
    state = projectSession(state, { type: 'output', id: 'a', data: 'x', cursor: 5 });
    const next = projectSession(state, { type: 'closed', id: 'a', exitCode: 0 });
    expect(next.order).toEqual(['b']);
    expect(next.sessions.a).toBeUndefined();
    expect(next.cursors.a).toBeUndefined();
  });

  test('closing an unknown session is a no-op', () => {
    const warn = vi.fn();
    const next = projectSession(EMPTY_PROJECTION, { type: 'closed', id: 'ghost', exitCode: null }, warn);
    expect(next).toBe(EMPTY_PROJECTION);
    expect(warn).toHaveBeenCalled();
  });
});

describe('selectors', () => {
  test('orderedSessions returns snapshots in creation order', () => {
    const state = reduceSessions([created(snapshot('a')), created(snapshot('b'))]);
    expect(orderedSessions(state).map((s) => s.id)).toEqual(['a', 'b']);
  });

  test('sessionsForProject filters by projectPath, preserving order', () => {
    const state = reduceSessions([
      created(snapshot('a', { projectPath: '/x' })),
      created(snapshot('b', { projectPath: '/y' })),
      created(snapshot('c', { projectPath: '/x' })),
    ]);
    expect(sessionsForProject(state, '/x').map((s) => s.id)).toEqual(['a', 'c']);
  });
});

describe('reduceSessions — full stream replay', () => {
  test('models a realistic spawn → run → ready → close lifecycle', () => {
    const events: SessionEvent[] = [
      created(snapshot('a', { state: 'idle', attached: false })),
      { type: 'state-changed', id: 'a', prev: 'idle', state: 'running' },
      { type: 'output', id: 'a', data: 'building...', cursor: 11 },
      { type: 'resized', id: 'a', cols: 100, rows: 30 },
      { type: 'state-changed', id: 'a', prev: 'running', state: 'ready' },
      { type: 'output', id: 'a', data: '$ ', cursor: 13 },
    ];
    const state = reduceSessions(events);
    expect(state.sessions.a.state).toBe('ready');
    expect(state.sessions.a.cols).toBe(100);
    expect(state.cursors.a).toBe(13);

    const closed = projectSession(state, { type: 'closed', id: 'a', exitCode: 0 });
    expect(closed).toEqual<SessionProjection>(EMPTY_PROJECTION);
  });

  test('does not mutate the input state', () => {
    const state = reduceSessions([created(snapshot('a'))]);
    const frozen = JSON.stringify(state);
    projectSession(state, { type: 'state-changed', id: 'a', prev: 'idle', state: 'running' });
    expect(JSON.stringify(state)).toBe(frozen);
  });
});
