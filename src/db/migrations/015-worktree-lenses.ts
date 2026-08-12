import type Database from 'better-sqlite3';

/**
 * A lens over a worktree's own diff.
 *
 * Mode is part of the key because the diff panel switches between the working
 * tree's changes and the branch's on its own, so a lens written for one must
 * not appear over the other.
 *
 * `pin` is what the lens was written against — two SHAs for a branch diff, a
 * fingerprint for a working-tree diff. Compared, never parsed.
 */
export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS worktree_lenses (
      worktree_path TEXT NOT NULL,
      mode TEXT NOT NULL,
      pin TEXT NOT NULL,
      groups TEXT NOT NULL,
      lens_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (worktree_path, mode)
    );
  `);
}
