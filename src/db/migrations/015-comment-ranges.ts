import type Database from 'better-sqlite3';

/**
 * Comments anchor to a range of lines and record the code they were written
 * about, on both the worktree diff and a pull request.
 *
 * `snippet` supersedes `diff_notes.line_text`, which held one line. The old
 * column is left in place — SQLite can drop a column only from 3.35, and an
 * unread column costs nothing.
 */
export function up(db: Database.Database): void {
  const columns = (table: string) =>
    new Set((db.prepare(`PRAGMA table_info('${table}')`).all() as { name: string }[]).map((c) => c.name));

  const notes = columns('diff_notes');
  if (!notes.has('start_line')) db.exec('ALTER TABLE diff_notes ADD COLUMN start_line INTEGER');
  if (!notes.has('snippet')) {
    db.exec('ALTER TABLE diff_notes ADD COLUMN snippet TEXT');
    db.exec('UPDATE diff_notes SET snippet = line_text');
  }

  const drafts = columns('github_review_drafts');
  if (!drafts.has('snippet')) db.exec('ALTER TABLE github_review_drafts ADD COLUMN snippet TEXT');
  // The head a draft's anchor was read against. A draft still carrying an older
  // head than the pull request's is one the re-anchor pass could not place.
  if (!drafts.has('head_sha')) db.exec('ALTER TABLE github_review_drafts ADD COLUMN head_sha TEXT');
}
