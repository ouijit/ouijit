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
import { up as migration010 } from '../db/migrations/010-project-icon-color';

/** Build an in-memory DB migrated through version 9 (pre-icon-color). */
function dbAtVersion9(): Database.Database {
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
    migration009,
  ]) {
    up(db);
  }
  db.prepare("INSERT INTO projects (path, name) VALUES ('/projects/app', 'App')").run();
  return db;
}

describe('migration 010 — project icon color', () => {
  test('adds a nullable icon_color column defaulting to null', () => {
    const db = dbAtVersion9();

    migration010(db);

    const columns = db.prepare("PRAGMA table_info('projects')").all() as { name: string }[];
    expect(columns.some((c) => c.name === 'icon_color')).toBe(true);

    const row = db.prepare("SELECT icon_color FROM projects WHERE path = '/projects/app'").get() as {
      icon_color: string | null;
    };
    expect(row.icon_color).toBeNull();
  });

  test('is idempotent when run twice', () => {
    const db = dbAtVersion9();

    migration010(db);
    expect(() => migration010(db)).not.toThrow();

    const columns = db.prepare("PRAGMA table_info('projects')").all() as { name: string }[];
    expect(columns.filter((c) => c.name === 'icon_color')).toHaveLength(1);
  });

  test('stores a custom color once set', () => {
    const db = dbAtVersion9();
    migration010(db);

    db.prepare("UPDATE projects SET icon_color = '#FF6B6B' WHERE path = '/projects/app'").run();

    const row = db.prepare("SELECT icon_color FROM projects WHERE path = '/projects/app'").get() as {
      icon_color: string | null;
    };
    expect(row.icon_color).toBe('#FF6B6B');
  });
});
