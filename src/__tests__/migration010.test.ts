import { describe, test, expect } from 'vitest';
import Database from 'better-sqlite3';
import { up as migration001 } from '../db/migrations/001-initial';
import { up as migration010 } from '../db/migrations/010-add-sessions';

/** Build an in-memory DB with just the initial schema, then add sessions. */
function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migration001(db);
  return db;
}

describe('migration 010 — add sessions table', () => {
  test('creates the sessions table with the durable columns', () => {
    const db = freshDb();
    migration010(db);

    const cols = (db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(
      expect.arrayContaining([
        'id',
        'last_state',
        'task_id',
        'worktree_path',
        'label',
        'project_path',
        'command',
        'sandboxed',
        'is_runner',
        'parent_id',
        'created_at',
        'buffer',
        'cols',
        'rows',
        'updated_at',
      ]),
    );
  });

  test('persists a session row independent of the projects table', () => {
    const db = freshDb();
    migration010(db);

    // No matching project row — sessions intentionally have no FK to projects.
    db.prepare(
      `INSERT INTO sessions (id, last_state, label, project_path, created_at, cols, rows)
       VALUES ('s1', 'running', 'Agent', '/gone/project', '2026-06-13T00:00:00Z', 80, 24)`,
    ).run();

    const row = db.prepare('SELECT id, last_state, buffer FROM sessions WHERE id = ?').get('s1') as {
      id: string;
      last_state: string;
      buffer: string;
    };
    expect(row.id).toBe('s1');
    expect(row.last_state).toBe('running');
    // Buffer defaults to an empty inline ref.
    expect(JSON.parse(row.buffer)).toEqual({ kind: 'inline', chunks: [] });
  });

  test('is idempotent on re-run', () => {
    const db = freshDb();
    migration010(db);
    expect(() => migration010(db)).not.toThrow();
  });
});
