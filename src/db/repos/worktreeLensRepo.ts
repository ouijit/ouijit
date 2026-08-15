import type Database from 'better-sqlite3';

export interface WorktreeLensRow {
  worktree_path: string;
  project_path: string;
  mode: string;
  pin: string;
  groups: string;
  lens_name: string | null;
  created_at: string;
}

/** One lens per worktree per mode — writing another replaces it. */
export class WorktreeLensRepo {
  constructor(private db: Database.Database) {}

  get(worktreePath: string, mode: string): WorktreeLensRow | undefined {
    return this.db
      .prepare('SELECT * FROM worktree_lenses WHERE worktree_path = ? AND mode = ?')
      .get(worktreePath, mode) as WorktreeLensRow | undefined;
  }

  save(
    worktreePath: string,
    projectPath: string,
    mode: string,
    pin: string,
    groups: string,
    lensName: string | null,
  ): void {
    this.db
      .prepare(
        `INSERT INTO worktree_lenses (worktree_path, project_path, mode, pin, groups, lens_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(worktree_path, mode) DO UPDATE SET
           project_path = excluded.project_path,
           pin = excluded.pin,
           groups = excluded.groups,
           lens_name = excluded.lens_name,
           created_at = excluded.created_at`,
      )
      .run(worktreePath, projectPath, mode, pin, groups, lensName);
  }

  /**
   * Follow a lens that has been renamed, for the same reason `PrLensRepo` does:
   * the stored grouping records which lens wrote it, and that record is a name.
   */
  rename(projectPath: string, from: string, to: string): void {
    this.db
      .prepare('UPDATE worktree_lenses SET lens_name = ? WHERE project_path = ? AND lens_name = ?')
      .run(to, projectPath, from);
  }
}
