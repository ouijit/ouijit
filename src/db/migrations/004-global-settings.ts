import type Database from 'better-sqlite3';

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS global_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}
