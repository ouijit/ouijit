import type Database from 'better-sqlite3';

/**
 * A lens over a worktree's own diff.
 *
 * Keyed by worktree and mode rather than by pull request. Mode is part of the
 * key because the diff panel switches between the working tree's changes and
 * the branch's on its own — committing your work changes which diff you are
 * looking at, and a lens written for one would otherwise appear over the other.
 *
 * `pin` is what the lens was written against: two SHAs for a branch diff, a
 * fingerprint of the change for a working-tree diff, which has no revision to
 * name. It is compared, never parsed.
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
