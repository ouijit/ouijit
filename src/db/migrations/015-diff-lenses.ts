import type Database from 'better-sqlite3';

/**
 * One table for every lens, whatever diff it was written over.
 *
 * `subject_key` says which diff — `pr:<number>`, or `wt:<path>:<mode>` — and is
 * only ever compared, so what a subject puts in it is that subject's business.
 * `pin` is the same bargain: two SHAs for a pull request or a branch diff, a
 * fingerprint of the change for a working tree.
 *
 * The drops are load-bearing rather than defensive. `github_pr_lenses` and
 * `worktree_lenses` were this table under two names, differing only in whether
 * the invariant was called `head_sha` or generalised to a pin. Neither shipped,
 * but a working copy from that period has them.
 */
export function up(db: Database.Database): void {
  db.exec(`
    DROP TABLE IF EXISTS github_pr_lenses;
    DROP TABLE IF EXISTS worktree_lenses;

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
