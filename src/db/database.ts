import Database from 'better-sqlite3';
import path from 'node:path';
import { app } from 'electron';
import { up as migration001 } from './migrations/001-initial';
import { up as migration002 } from './migrations/002-add-review-hook';
import { up as migration003 } from './migrations/003-add-tags';

const migrations = [
  { version: 1, up: migration001 },
  { version: 2, up: migration002 },
  { version: 3, up: migration003 },
];

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (db) return db;

  const dbPath = path.join(app.getPath('userData'), 'ouijit.db');
  db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  runMigrations(db);

  return db;
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all()
      .map((row: { version: number }) => row.version)
  );

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;

    db.transaction(() => {
      migration.up(db);
      db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(migration.version);
    })();
  }
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Initialize an in-memory database for testing.
 * Replaces the singleton so all repos use the test DB.
 */
export function _initTestDatabase(): Database.Database {
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}
