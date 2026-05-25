import { describe, test, expect } from 'vitest';
import Database from 'better-sqlite3';
import { up as migration001 } from '../db/migrations/001-initial';
import { up as migration002 } from '../db/migrations/002-add-review-hook';
import { up as migration003 } from '../db/migrations/003-add-tags';
import { up as migration004 } from '../db/migrations/004-global-settings';
import { up as migration005 } from '../db/migrations/005-project-sort-order';
import { up as migration006 } from '../db/migrations/006-add-scripts';
import { up as migration007 } from '../db/migrations/007-remove-sandbox-config';
import { up as migration008 } from '../db/migrations/008-add-parent-task';
import { up as migration009 } from '../db/migrations/009-rename-cleanup-hook-to-done';

/** Build an in-memory DB migrated through version 8 (pre-rename). */
function dbAtVersion8(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const up of [
    migration001,
    migration002,
    migration003,
    migration004,
    migration005,
    migration006,
    migration007,
    migration008,
  ]) {
    up(db);
  }
  db.prepare("INSERT INTO projects (path, name) VALUES ('/projects/app', 'App')").run();
  return db;
}

describe('migration 009 — rename cleanup hook to done', () => {
  test('converts an existing cleanup hook row to done', () => {
    const db = dbAtVersion8();
    db.prepare(
      "INSERT INTO hooks (id, project_path, type, name, command) VALUES ('h1', '/projects/app', 'cleanup', 'Clean', 'rm -rf tmp')",
    ).run();

    migration009(db);

    const row = db.prepare("SELECT type, name, command FROM hooks WHERE id = 'h1'").get() as {
      type: string;
      name: string;
      command: string;
    };
    expect(row.type).toBe('done');
    expect(row.name).toBe('Clean');
    expect(row.command).toBe('rm -rf tmp');
  });

  test('leaves other hook types untouched', () => {
    const db = dbAtVersion8();
    db.prepare(
      "INSERT INTO hooks (id, project_path, type, name, command) VALUES ('h1', '/projects/app', 'start', 'Setup', 'npm install')",
    ).run();
    db.prepare(
      "INSERT INTO hooks (id, project_path, type, name, command) VALUES ('h2', '/projects/app', 'cleanup', 'Clean', 'rm -rf tmp')",
    ).run();

    migration009(db);

    const types = (db.prepare('SELECT type FROM hooks ORDER BY type').all() as { type: string }[]).map((r) => r.type);
    expect(types).toEqual(['done', 'start']);
  });

  test('accepts done and rejects cleanup after the migration', () => {
    const db = dbAtVersion8();
    migration009(db);

    expect(() =>
      db
        .prepare(
          "INSERT INTO hooks (id, project_path, type, name, command) VALUES ('h1', '/projects/app', 'done', 'Done', 'git push')",
        )
        .run(),
    ).not.toThrow();

    expect(() =>
      db
        .prepare(
          "INSERT INTO hooks (id, project_path, type, name, command) VALUES ('h2', '/projects/app', 'cleanup', 'Clean', 'rm -rf tmp')",
        )
        .run(),
    ).toThrow();
  });
});
