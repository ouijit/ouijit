import type Database from 'better-sqlite3';

/**
 * One table for every lens, whatever diff it was written over.
 *
 * A pull request's lens and a worktree's arrived as two tables because they
 * arrived as two features, and they differed in one column: the pull request
 * called the invariant `head_sha`, the worktree generalised it to a pin. That
 * is not two concepts. Neither shipped, so this collapses them rather than
 * carrying a second copy of every read, write and rename for ever.
 *
 * `subject_key` says which diff — `pr:<number>`, or `wt:<path>:<mode>` — and
 * is only ever compared, so what a subject puts in it is that subject's
 * business. `pin` is the same bargain: two SHAs for a pull request or a branch
 * diff, a fingerprint of the change for a working tree.
 *
 * The drops are load-bearing rather than defensive: this branch shipped both
 * of the old tables to its own working copies, and a database that has one is
 * a database this has to run over.
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
