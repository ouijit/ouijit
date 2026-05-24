import type Database from 'better-sqlite3';

export function up(db: Database.Database): void {
  // Rename hook type 'cleanup' → 'done'. SQLite can't alter the CHECK
  // constraint in place, so we recreate the table and convert the type
  // during the copy — updating in place would violate the old constraint.
  db.exec(`
    CREATE TABLE hooks_new (
      id TEXT PRIMARY KEY,
      project_path TEXT NOT NULL REFERENCES projects(path) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('start', 'continue', 'run', 'review', 'done', 'editor')),
      name TEXT NOT NULL,
      command TEXT NOT NULL,
      description TEXT,
      UNIQUE(project_path, type)
    );

    INSERT INTO hooks_new (id, project_path, type, name, command, description)
    SELECT id, project_path,
           CASE WHEN type = 'cleanup' THEN 'done' ELSE type END,
           name, command, description
    FROM hooks;

    DROP TABLE hooks;

    ALTER TABLE hooks_new RENAME TO hooks;
  `);
}
