import type Database from 'better-sqlite3';

/**
 * Notes written on a worktree diff.
 *
 * Keyed by worktree path rather than by task or terminal, since the changes
 * outlive the terminal that was open when the notes were written. A plain
 * shell's diff is of the project itself, which is a worktree path like any
 * other.
 */
export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS diff_notes (
      id TEXT PRIMARY KEY,
      worktree_path TEXT NOT NULL,
      path TEXT NOT NULL,
      line INTEGER NOT NULL,
      side TEXT NOT NULL,
      line_text TEXT,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_diff_notes_worktree ON diff_notes(worktree_path);
  `);
}
