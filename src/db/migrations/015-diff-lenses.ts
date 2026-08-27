import type Database from 'better-sqlite3';

/** Agent-written groupings of a diff, one per thing a lens can be written over. */
export function up(db: Database.Database): void {
  db.exec(`
    -- subject_key says which diff -- pr:<number>, or wt:<path>:<base> -- and is
    -- only ever compared, so what a subject puts in it is that subject's
    -- business. pin is the same bargain: two SHAs where the diff has revisions
    -- to name, a fingerprint of the change for a working tree.
    CREATE TABLE IF NOT EXISTS diff_lenses (
      project_path TEXT NOT NULL,
      subject_key TEXT NOT NULL,
      pin TEXT NOT NULL,
      groups TEXT NOT NULL,
      lens_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (project_path, subject_key)
    );
  `);
}
