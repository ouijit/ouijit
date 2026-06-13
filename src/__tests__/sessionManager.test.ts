import { describe, test, expect, beforeEach } from 'vitest';
import { getDatabase } from '../db/database';
import { SessionRepo } from '../db/repos/sessionRepo';
import { SessionManager } from '../sessions/manager';
import type { BackendHandlers, BackendPty, BackendSpawnInput, SessionPtyBackend } from '../sessions/backend';
import type { SessionEvent } from '../sessions/model';

interface FakePty extends BackendPty {
  written: string[];
  resized: [number, number][];
  killed: boolean;
}

class FakeBackend implements SessionPtyBackend {
  spawns: { input: BackendSpawnInput; handlers: BackendHandlers; pty: FakePty }[] = [];

  spawn(input: BackendSpawnInput, handlers: BackendHandlers): BackendPty {
    const written: string[] = [];
    const resized: [number, number][] = [];
    const pty: FakePty = {
      ptyId: `pty-${this.spawns.length + 1}`,
      written,
      resized,
      killed: false,
      write: (d) => written.push(d),
      resize: (c, r) => resized.push([c, r]),
      kill() {
        this.killed = true;
      },
    };
    this.spawns.push({ input, handlers, pty });
    return pty;
  }

  last() {
    return this.spawns[this.spawns.length - 1];
  }
}

function build() {
  const backend = new FakeBackend();
  const events: SessionEvent[] = [];
  const store = new SessionRepo(getDatabase());
  let counter = 0;
  const manager = new SessionManager({
    store,
    backend,
    emit: (e) => events.push(e),
    generateId: () => `session-${++counter}`,
  });
  return { manager, backend, events, store };
}

describe('SessionManager', () => {
  beforeEach(() => {
    // db reset by global setup beforeEach
  });

  test('spawn creates a running session, emits created + state-changed, persists it', () => {
    const { manager, backend, events, store } = build();
    const result = manager.spawn({ projectPath: '/proj', command: 'claude', label: 'Agent' });

    expect(result.session.id).toBe('session-1');
    expect(result.session.state).toBe('running');
    expect(result.session.attached).toBe(true);
    expect(backend.spawns).toHaveLength(1);
    expect(backend.last().input.command).toBe('claude');

    const kinds = events.map((e) => e.type);
    expect(kinds).toEqual(['created', 'state-changed']);

    const persisted = store.get('session-1');
    expect(persisted?.lastState).toBe('running');
    expect(persisted?.command).toBe('claude');
  });

  test('output appends to the buffer and emits output events with the cursor', () => {
    const { manager, backend, events } = build();
    manager.spawn({ projectPath: '/proj' });
    events.length = 0;

    backend.last().handlers.onData('hello ');
    backend.last().handlers.onData('world');

    const outputs = events.filter((e): e is Extract<SessionEvent, { type: 'output' }> => e.type === 'output');
    expect(outputs.map((o) => o.data)).toEqual(['hello ', 'world']);
    expect(outputs[outputs.length - 1].cursor).toBe(11);

    const attach = manager.attach('session-1');
    expect(attach?.replay).toBe('hello world');
    expect(attach?.cursor).toBe(11);
  });

  test('rejects an illegal state transition', () => {
    const { manager } = build();
    manager.spawn({ projectPath: '/proj' }); // running
    // running -> running is a no-op true; running -> awaiting is legal; force an illegal one:
    // 'closed' is not a state, so try idle->awaiting after a clean exit (idle only allows running).
    expect(manager.setState('session-1', 'awaiting')).toBe(true); // running -> awaiting legal
    expect(manager.setState('session-1', 'ready')).toBe(true); // awaiting -> ready legal
    // ready -> idle legal, then idle -> awaiting illegal
    expect(manager.setState('session-1', 'idle')).toBe(true);
    expect(manager.setState('session-1', 'awaiting')).toBe(false);
  });

  test('detach keeps the process alive', () => {
    const { manager, backend } = build();
    manager.spawn({ projectPath: '/proj' });
    manager.detach('session-1');

    expect(backend.last().pty.killed).toBe(false);
    expect(manager.get('session-1')?.attached).toBe(true);
  });

  test('a clean process exit leaves a dormant idle session; non-zero leaves error', () => {
    const { manager, backend } = build();
    manager.spawn({ projectPath: '/proj' });
    backend.last().handlers.onExit(0);

    const snap = manager.get('session-1');
    expect(snap?.state).toBe('idle');
    expect(snap?.attached).toBe(false);

    const { manager: m2, backend: b2 } = build();
    m2.spawn({ projectPath: '/proj' });
    b2.last().handlers.onExit(1);
    expect(m2.get('session-1')?.state).toBe('error');
  });

  test('reattach respawns a dormant session and returns its replay buffer', async () => {
    const { manager, backend } = build();
    manager.spawn({ projectPath: '/proj' });
    backend.last().handlers.onData('prior output');
    backend.last().handlers.onExit(0); // dormant, idle

    expect(backend.spawns).toHaveLength(1);

    const result = await manager.reattach('session-1');
    expect(backend.spawns).toHaveLength(2); // respawned
    expect(result.session.state).toBe('running');
    expect(result.session.attached).toBe(true);
    expect(result.replay).toBe('prior output');
  });

  test('reattach on a live session does not respawn', async () => {
    const { manager, backend } = build();
    manager.spawn({ projectPath: '/proj' });
    await manager.reattach('session-1');
    expect(backend.spawns).toHaveLength(1);
  });

  test('close kills the process, emits closed, and deletes the durable record', () => {
    const { manager, backend, events, store } = build();
    manager.spawn({ projectPath: '/proj' });
    events.length = 0;

    manager.close('session-1');

    expect(backend.last().pty.killed).toBe(true);
    expect(events).toEqual([{ type: 'closed', id: 'session-1', exitCode: null }]);
    expect(manager.get('session-1')).toBeNull();
    expect(store.get('session-1')).toBeNull();
  });

  test('write and resize delegate to the live process; resize emits an event', () => {
    const { manager, backend, events } = build();
    manager.spawn({ projectPath: '/proj' });
    events.length = 0;

    manager.write('session-1', 'ls\n');
    manager.resize('session-1', 100, 30);

    expect(backend.last().pty.written).toEqual(['ls\n']);
    expect(backend.last().pty.resized).toEqual([[100, 30]]);
    expect(manager.get('session-1')?.cols).toBe(100);
    expect(events).toContainEqual({ type: 'resized', id: 'session-1', cols: 100, rows: 30 });
  });

  test('rehydrate brings persisted sessions back dormant', () => {
    // Persist via one manager, then rehydrate in a fresh one over the same store.
    const { manager, backend } = build();
    manager.spawn({ projectPath: '/proj', command: 'claude', label: 'Agent' });
    backend.last().handlers.onData('scrollback');
    manager.persistAll();

    const { manager: fresh } = build();
    const count = fresh.rehydrate();
    expect(count).toBe(1);

    const snap = fresh.get('session-1');
    expect(snap).not.toBeNull();
    expect(snap?.state).toBe('idle'); // dormant, no process survived
    expect(snap?.attached).toBe(false);
    expect(snap?.label).toBe('Agent');

    // Buffer scroll-back is restored for replay.
    expect(fresh.attach('session-1')?.replay).toBe('scrollback');
  });

  test('list and get reflect known sessions', () => {
    const { manager } = build();
    manager.spawn({ projectPath: '/proj', label: 'one' });
    manager.spawn({ projectPath: '/proj', label: 'two' });

    expect(manager.list().map((s) => s.label)).toEqual(['one', 'two']);
    expect(manager.get('session-2')?.label).toBe('two');
    expect(manager.get('missing')).toBeNull();
  });
});
