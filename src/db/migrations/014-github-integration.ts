import type Database from 'better-sqlite3';

/**
 * Schema for the GitHub integration: the task→PR/issue link, and local storage
 * for review comments that have not been submitted yet.
 *
 * The link columns are nullable — most tasks never touch GitHub, and a task can
 * be linked to an issue long before it has a PR.
 *
 * Drafts live in their own table because they must survive a restart (a
 * half-written review is lost work otherwise) and because the alternative,
 * creating a server-side PENDING review as the user types, would mean a network
 * write per edit. The whole batch goes up as one `POST /pulls/{n}/reviews` on
 * submit. Scoped by (project_path, pr_number) rather than by task, since a
 * review can be written in an ephemeral session for a teammate's PR that has no
 * task at all.
 *
 * Idempotent so a re-run on a partially migrated database is harmless.
 */
export function up(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info('tasks')").all() as { name: string }[];
  const has = (name: string) => columns.some((c) => c.name === name);

  if (!has('github_pr_number')) {
    db.exec('ALTER TABLE tasks ADD COLUMN github_pr_number INTEGER');
  }
  if (!has('github_issue_number')) {
    db.exec('ALTER TABLE tasks ADD COLUMN github_issue_number INTEGER');
  }

  db.exec(`
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
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_review_drafts_pr
      ON github_review_drafts (project_path, pr_number);
  `);
}
