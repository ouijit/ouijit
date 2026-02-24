import type Database from 'better-sqlite3';

export function up(db: Database.Database): void {
  // SQLite doesn't support ALTER CHECK, so recreate the hooks table
  // with the updated constraint that includes 'review'.
  db.exec(`
    CREATE TABLE hooks_new (
      id TEXT PRIMARY KEY,
      project_path TEXT NOT NULL REFERENCES projects(path) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('start', 'continue', 'run', 'review', 'cleanup', 'sandbox-setup', 'editor')),
      name TEXT NOT NULL,
      command TEXT NOT NULL,
      description TEXT,
      UNIQUE(project_path, type)
    );

    INSERT INTO hooks_new SELECT * FROM hooks;

    DROP TABLE hooks;

    ALTER TABLE hooks_new RENAME TO hooks;
  `);
}
