import type Database from 'better-sqlite3';

export function up(db: Database.Database): void {
  // Remove sandbox-setup from hooks CHECK constraint by recreating the table
  db.exec(`
    DELETE FROM hooks WHERE type = 'sandbox-setup';

    CREATE TABLE hooks_new (
      id TEXT PRIMARY KEY,
      project_path TEXT NOT NULL REFERENCES projects(path) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('start', 'continue', 'run', 'review', 'cleanup', 'editor')),
      name TEXT NOT NULL,
      command TEXT NOT NULL,
      description TEXT,
      UNIQUE(project_path, type)
    );

    INSERT INTO hooks_new SELECT * FROM hooks;

    DROP TABLE hooks;

    ALTER TABLE hooks_new RENAME TO hooks;
  `);

  // Drop sandbox config columns from project_settings.
  // SQLite doesn't support DROP COLUMN before 3.35.0, so recreate the table.
  db.exec(`
    CREATE TABLE project_settings_new (
      project_path TEXT PRIMARY KEY REFERENCES projects(path) ON DELETE CASCADE,
      kill_existing_on_run INTEGER NOT NULL DEFAULT 0
    );

    INSERT INTO project_settings_new (project_path, kill_existing_on_run)
    SELECT project_path, kill_existing_on_run FROM project_settings;

    DROP TABLE project_settings;

    ALTER TABLE project_settings_new RENAME TO project_settings;
  `);
}
