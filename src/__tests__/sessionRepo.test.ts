import { describe, test, expect } from 'vitest';
import { getDatabase } from '../db/database';
import { SessionRepo } from '../db/repos/sessionRepo';
import type { DurableSession } from '../sessions/model';

function makeDurable(overrides: Partial<DurableSession> = {}): DurableSession {
  return {
    id: 's1',
    lastState: 'running',
    taskId: 42,
    worktreePath: '/wt/path',
    label: 'Agent',
    projectPath: '/proj',
    command: 'claude',
    sandboxed: false,
    isRunner: false,
    parentId: null,
    createdAt: '2026-06-13T00:00:00Z',
    buffer: { kind: 'inline', chunks: ['line1\n', 'line2\n'] },
    cols: 120,
    rows: 40,
    ...overrides,
  };
}

describe('SessionRepo', () => {
  test('upsert + get round-trips every durable field', () => {
    const repo = new SessionRepo(getDatabase());
    const durable = makeDurable();
    repo.upsert(durable);

    expect(repo.get('s1')).toEqual(durable);
  });

  test('upsert updates an existing row in place', () => {
    const repo = new SessionRepo(getDatabase());
    repo.upsert(makeDurable());
    repo.upsert(makeDurable({ lastState: 'error', label: 'Renamed', buffer: { kind: 'inline', chunks: ['x'] } }));

    const got = repo.get('s1');
    expect(got?.lastState).toBe('error');
    expect(got?.label).toBe('Renamed');
    expect(got?.buffer).toEqual({ kind: 'inline', chunks: ['x'] });
    expect(repo.getAll()).toHaveLength(1);
  });

  test('boolean and null columns survive the round-trip', () => {
    const repo = new SessionRepo(getDatabase());
    repo.upsert(
      makeDurable({ id: 's2', sandboxed: true, isRunner: true, parentId: 's1', taskId: null, worktreePath: null }),
    );

    const got = repo.get('s2');
    expect(got?.sandboxed).toBe(true);
    expect(got?.isRunner).toBe(true);
    expect(got?.parentId).toBe('s1');
    expect(got?.taskId).toBeNull();
    expect(got?.worktreePath).toBeNull();
  });

  test('upsertAll writes many rows in one transaction', () => {
    const repo = new SessionRepo(getDatabase());
    repo.upsertAll([makeDurable({ id: 'a' }), makeDurable({ id: 'b' }), makeDurable({ id: 'c' })]);
    expect(repo.getAll().map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  test('delete removes a row', () => {
    const repo = new SessionRepo(getDatabase());
    repo.upsert(makeDurable());
    repo.delete('s1');
    expect(repo.get('s1')).toBeNull();
    expect(repo.getAll()).toHaveLength(0);
  });

  test('get returns null for an unknown id', () => {
    const repo = new SessionRepo(getDatabase());
    expect(repo.get('nope')).toBeNull();
  });
});
