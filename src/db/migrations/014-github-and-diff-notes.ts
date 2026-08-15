import type Database from 'better-sqlite3';

/**
 * Everything the GitHub integration and diff notes need.
 *
 * Pull requests, issues, review drafts, lenses and the notes written on a
 * worktree diff, as one migration rather than the five they were developed as:
 * none of those shipped, and three only added a column to a table the one
 * before had just created.
 *
 * The guards are load-bearing rather than defensive: rolling a database back
 * to 13 is done by deleting the rows above it from `schema_migrations`, which
 * leaves the tables in place, and this has to re-apply over them without
 * failing on a duplicate column.
 */
export function up(db: Database.Database): void {
  const taskColumns = db.prepare("PRAGMA table_info('tasks')").all() as { name: string }[];
  const hasTaskColumn = (name: string) => taskColumns.some((c) => c.name === name);

  if (!hasTaskColumn('github_pr_number')) {
    db.exec('ALTER TABLE tasks ADD COLUMN github_pr_number INTEGER');
  }
  if (!hasTaskColumn('github_issue_number')) {
    db.exec('ALTER TABLE tasks ADD COLUMN github_issue_number INTEGER');
  }

  db.exec(`
    -- Review comments written but not yet sent to GitHub. Keyed by
    -- (project_path, pr_number) so a review of a PR with no task behind it
    -- persists the same way a task-backed one does. The origin column is who
    -- wrote it: 'human' from the renderer, or the CLI caller's name.
    --
    -- Comments stay outside the parentheses: SQLite keeps anything inside them
    -- in sqlite_master as part of the table's own schema text.
    CREATE TABLE IF NOT EXISTS github_review_drafts (
      id TEXT PRIMARY KEY,
      project_path TEXT NOT NULL,
      pr_number INTEGER NOT NULL,
      path TEXT NOT NULL,
      line INTEGER NOT NULL,
      side TEXT NOT NULL DEFAULT 'RIGHT',
      start_line INTEGER,
      body TEXT NOT NULL,
      reply_to_thread_id TEXT,
      reply_to_comment_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      origin TEXT NOT NULL DEFAULT 'human'
    );

    CREATE INDEX IF NOT EXISTS idx_review_drafts_pr
      ON github_review_drafts (project_path, pr_number);

    -- Notes written on a worktree diff, keyed by worktree path rather than by
    -- task or terminal, since the changes outlive the terminal that was open
    -- when the notes were written.
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
