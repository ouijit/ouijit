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
      -- Which lens wrote it, and what that lens was called at the time. Both
      -- null for a grouping an agent posted over the CLI, which went through
      -- no lens at all; the name is a snapshot, read only once the lens it
      -- names has been deleted and there is nothing left to look up.
      lens_id TEXT,
      lens_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (project_path, subject_key)
    );
  `);
}
