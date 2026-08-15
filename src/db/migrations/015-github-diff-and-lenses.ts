import type Database from 'better-sqlite3';

/**
 * Everything the GitHub integration, diff notes and lenses need: pull requests,
 * issues, review drafts, the notes written on a worktree diff, and the lenses
 * read over either.
 *
 * 15 rather than 14, though it is the only migration this work adds. A database
 * that ran a build from the development period has 14 recorded and a partial
 * schema behind it — the review drafts and diff notes, but the lens table under
 * its old name and shape. The runner keys on the version alone, so numbering
 * this 14 would mean it never runs there and `diff_lenses` is never created.
 *
 * That is what the guards below are for as well. This has to be able to land on
 * a database that already has half of it.
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

    -- The lens table as it was first written, and as it was renamed to before
    -- being generalised: same rows, keyed by pull request and pinned to a head
    -- SHA. Neither shipped, but a database from that period has one of them.
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
