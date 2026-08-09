import type Database from 'better-sqlite3';

/**
 * What an agent leaves behind on a pull request.
 *
 * `origin` exists because a draft can now be written by something that is not
 * the person about to sign it. Sending a review is a human press either way, so
 * the queue has to say what came from where — twelve agent-written comments and
 * twelve you typed must not look identical. Free text rather than an enum so a
 * caller can name itself; the renderer treats it as untrusted display text.
 *
 * `github_pr_lenses` holds one lens per pull request per head. A
 * lens names the parts of a change and points each at the hunks that make
 * it up, so a diff can be read as the story it is rather than as files in
 * alphabetical order. Keyed by head SHA because it describes specific hunks:
 * after a force-push those hunks are gone, and a grouping of them would be a
 * confident description of code that no longer exists.
 *
 * Stored rather than recomputed because producing one costs an agent run — the
 * opposite of the drafts table's reasoning, which is about not losing work, but
 * the same conclusion.
 */
export function up(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info('github_review_drafts')").all() as { name: string }[];
  if (!columns.some((c) => c.name === 'origin')) {
    db.exec("ALTER TABLE github_review_drafts ADD COLUMN origin TEXT NOT NULL DEFAULT 'human'");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS github_pr_lenses (
      project_path TEXT NOT NULL,
      pr_number INTEGER NOT NULL,
      head_sha TEXT NOT NULL,
      groups TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (project_path, pr_number)
    );
  `);
}
