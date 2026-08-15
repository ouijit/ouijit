import type Database from 'better-sqlite3';

/**
 * Everything the GitHub integration, diff notes and lenses need.
 *
 * Pull requests, issues, review drafts, the notes written on a worktree diff
 * and the lenses read over either, as one migration rather than the six they
 * were developed as: none of those shipped, and most only added a column to a
 * table the one before had just created, or renamed a table nobody had.
 *
 * The guards and drops are load-bearing rather than defensive. Rolling a
 * database back to 13 is done by deleting the rows above it from
 * `schema_migrations`, which leaves the tables in place, so this has to
 * re-apply over them without failing on a duplicate column. And a working copy
 * from the development period has `github_pr_lenses` or `worktree_lenses`,
 * which were `diff_lenses` under two names, differing only in whether the
 * invariant was called `head_sha` or generalised to a pin.
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

    DROP TABLE IF EXISTS github_pr_lenses;
    DROP TABLE IF EXISTS worktree_lenses;

    -- One row per lens, whatever diff it was written over. subject_key says
    -- which diff -- pr:<number>, or wt:<path>:<mode> -- and is only ever
    -- compared, so what a subject puts in it is that subject's business. pin is
    -- the same bargain: two SHAs for a pull request or a branch diff, a
    -- fingerprint of the change for a working tree.
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
