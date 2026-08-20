import type Database from 'better-sqlite3';

/**
 * Everything the GitHub integration and diff notes need: pull requests, issues,
 * review drafts, and the notes written on a worktree diff.
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
    -- Review comments written but not yet sent to GitHub, keyed by
    -- (project_path, pr_number) so a review of a PR with no task behind it
    -- persists too. origin is 'human' from the renderer, or the CLI caller's
    -- name. head_sha is the head the anchor was last read against: a draft
    -- carrying an older one is one the re-anchor pass could not place.
    --
    -- Keep comments outside the parentheses: SQLite stores anything inside them
    -- in sqlite_master as part of the table's schema text.
    CREATE TABLE IF NOT EXISTS github_review_drafts (
      id TEXT PRIMARY KEY,
      project_path TEXT NOT NULL,
      pr_number INTEGER NOT NULL,
      path TEXT NOT NULL,
      line INTEGER NOT NULL,
      side TEXT NOT NULL DEFAULT 'RIGHT',
      start_line INTEGER,
      snippet TEXT,
      head_sha TEXT,
      body TEXT NOT NULL,
      reply_to_thread_id TEXT,
      reply_to_comment_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      origin TEXT NOT NULL DEFAULT 'human'
    );

    CREATE INDEX IF NOT EXISTS idx_review_drafts_pr
      ON github_review_drafts (project_path, pr_number);

    -- Notes written on a worktree diff, keyed by worktree path rather than task
    -- or terminal: the changes outlive the terminal that was open at the time.
    CREATE TABLE IF NOT EXISTS diff_notes (
      id TEXT PRIMARY KEY,
      worktree_path TEXT NOT NULL,
      path TEXT NOT NULL,
      line INTEGER NOT NULL,
      start_line INTEGER,
      side TEXT NOT NULL,
      snippet TEXT,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_diff_notes_worktree ON diff_notes(worktree_path);
  `);
}
