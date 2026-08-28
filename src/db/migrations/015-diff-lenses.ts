import type Database from 'better-sqlite3';

/** Agent-written groupings of a diff, one row per thing a lens can be written over. */
export function up(db: Database.Database): void {
  db.exec(`
    -- subject_key and pin are opaque to this table: whatever names a diff, and
    -- whatever says it has not moved, is the subject's to choose. A run records
    -- itself here before spawning an agent, so pin and groups are null until one
    -- answers. The columns are documented on \`DiffLensRow\`.
    CREATE TABLE IF NOT EXISTS diff_lenses (
      project_path TEXT NOT NULL,
      subject_key TEXT NOT NULL,
      pin TEXT,
      groups TEXT,
      lens_id TEXT,
      lens_name TEXT,
      omitted INTEGER NOT NULL DEFAULT 0,
      running_lens_id TEXT,
      running_since TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (project_path, subject_key)
    );
  `);
}
