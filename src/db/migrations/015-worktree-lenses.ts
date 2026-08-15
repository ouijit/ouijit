import type Database from 'better-sqlite3';

/**
 * A lens over a worktree's own diff.
 *
 * Mode is part of the key because the diff panel switches between the working
 * tree's changes and the branch's on its own, so a lens written for one must
 * not appear over the other.
 *
 * `pin` is what the lens was written against — two SHAs for a branch diff, a
 * fingerprint for a working-tree diff. Compared, never parsed.
 *
 * The project is carried alongside the worktree so a lens renamed in one
 * project's settings does not follow the same name through another's.
 */
export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS worktree_lenses (
      worktree_path TEXT NOT NULL,
      project_path TEXT NOT NULL DEFAULT '',
      mode TEXT NOT NULL,
      pin TEXT NOT NULL,
      groups TEXT NOT NULL,
      lens_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (worktree_path, mode)
    );
  `);

  // `project_path` arrived after the table did, and this migration is the only
  // one that has ever created it — so a database that ran the earlier version
  // has the table without the column, and `CREATE TABLE IF NOT EXISTS` above
  // will not add it. The default is what makes the `ALTER` legal; a row left
  // with it simply matches no project when a lens is renamed.
  const columns = db.prepare("PRAGMA table_info('worktree_lenses')").all() as { name: string }[];
  if (!columns.some((c) => c.name === 'project_path')) {
    db.exec("ALTER TABLE worktree_lenses ADD COLUMN project_path TEXT NOT NULL DEFAULT ''");
  }
}
