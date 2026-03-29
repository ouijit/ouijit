import type Database from 'better-sqlite3';

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE scripts (
      id TEXT PRIMARY KEY,
      project_path TEXT NOT NULL REFERENCES projects(path) ON DELETE CASCADE,
      name TEXT NOT NULL,
      command TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      UNIQUE(project_path, name)
    );
    CREATE INDEX idx_scripts_project ON scripts(project_path, sort_order);
  `);
}
