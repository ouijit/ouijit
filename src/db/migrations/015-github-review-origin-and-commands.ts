import type Database from 'better-sqlite3';

/**
 * Provenance on review drafts, and the table behind PR commands.
 *
 * `origin` exists because a draft can now be written by something that is not
 * the person about to sign it. Sending a review is a human press either way, so
 * the queue has to say what came from where — twelve agent-written comments and
 * twelve you typed must not look identical. It is free text rather than an enum
 * so a caller can name itself; the renderer treats it as untrusted display text.
 *
 * `github_pr_commands` holds named shell commands run with a pull request's
 * context. A lens (`mode = 'lens'`) emits grouping JSON on stdout and regroups
 * the diff; a terminal command (`mode = 'terminal'`) opens a session in the
 * pull request's worktree. They share a table because they are the same object
 * — a named command plus PR environment — differing only in what happens to the
 * output. Deliberately not a `HookType`: those six all fire on a task status
 * transition and all receive task environment, and a pull request action does
 * neither.
 *
 * Separate from 014 rather than folded into it: 014 has already been applied to
 * databases on this branch, so edits there would never re-run. Idempotent, so a
 * re-run against a partially migrated database is harmless.
 */
export function up(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info('github_review_drafts')").all() as { name: string }[];
  if (!columns.some((c) => c.name === 'origin')) {
    db.exec("ALTER TABLE github_review_drafts ADD COLUMN origin TEXT NOT NULL DEFAULT 'human'");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS github_pr_commands (
      id TEXT PRIMARY KEY,
      project_path TEXT NOT NULL,
      name TEXT NOT NULL,
      command TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'lens',
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_pr_commands_name
      ON github_pr_commands (project_path, name);
  `);
}
