import type Database from 'better-sqlite3';

/**
 * Comments written against a Linear issue but not yet posted.
 *
 * Keyed by (project_path, issue_id) so a draft on an issue with no task behind
 * it persists too. origin is 'human' from the renderer, or the CLI caller's
 * name — which is what tells a person, before they press Send, that an agent
 * wrote it.
 *
 * Keep comments outside the parentheses: SQLite stores anything inside them in
 * sqlite_master as part of the table's schema text.
 */
export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS linear_comment_drafts (
      id TEXT PRIMARY KEY,
      project_path TEXT NOT NULL,
      issue_id TEXT NOT NULL,
      body TEXT NOT NULL,
      origin TEXT NOT NULL DEFAULT 'human',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_linear_drafts_issue
      ON linear_comment_drafts (project_path, issue_id);
  `);
}
