import Database from 'better-sqlite3';
import { up as migration001 } from './migrations/001-initial';
import { up as migration002 } from './migrations/002-add-review-hook';
import { up as migration003 } from './migrations/003-add-tags';
import { up as migration004 } from './migrations/004-global-settings';
import { up as migration005 } from './migrations/005-project-sort-order';
import { up as migration006 } from './migrations/006-add-scripts';
import { up as migration007 } from './migrations/007-remove-sandbox-config';
import { up as migration008 } from './migrations/008-add-parent-task';

const migrations = [
  { version: 1, up: migration001 },
  { version: 2, up: migration002 },
  { version: 3, up: migration003 },
  { version: 4, up: migration004 },
  { version: 5, up: migration005 },
  { version: 6, up: migration006 },
  { version: 7, up: migration007 },
  { version: 8, up: migration008 },
];

let db: Database.Database | null = null;

export function initDatabase(dbPath: string): Database.Database {
  if (db) return db;

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);

  return db;
}

export function getDatabase(): Database.Database {
  if (!db) throw new Error('Database not initialized — call initDatabase() first');
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
    db
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((row: { version: number }) => row.version),
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
