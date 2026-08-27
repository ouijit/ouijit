import type Database from 'better-sqlite3';

export interface DiffLensRow {
  project_path: string;
  subject_key: string;
  /** What the lens was written against. Compared, never parsed. */
  pin: string;
  /** JSON: the groups, as written. Parsed and reconciled on the way out. */
  groups: string;
  /** The lens that wrote it, or null when an agent posted groups directly. */
  lens_name: string | null;
  created_at: string;
}

/**
 * One lens per thing a lens can be written over.
 *
 * A pull request and a worktree diff are the same row: both are a diff, both
 * are grouped by the same agent under the same named instruction, and both
 * have at most one — a second lens for the same change is a correction, not an
 * addition. What tells them apart is the subject key, and what tells a lens
 * that no longer fits is the pin, whose meaning belongs to whoever wrote it.
 */
export class DiffLensRepo {
  constructor(private db: Database.Database) {}

  get(projectPath: string, subjectKey: string): DiffLensRow | undefined {
    return this.db
      .prepare('SELECT * FROM diff_lenses WHERE project_path = ? AND subject_key = ?')
      .get(projectPath, subjectKey) as DiffLensRow | undefined;
  }

  save(projectPath: string, subjectKey: string, pin: string, groups: string, lensName: string | null): void {
    this.db
      .prepare(
        `INSERT INTO diff_lenses (project_path, subject_key, pin, groups, lens_name, created_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(project_path, subject_key) DO UPDATE SET
           pin = excluded.pin,
           groups = excluded.groups,
           lens_name = excluded.lens_name,
           created_at = excluded.created_at`,
      )
      .run(projectPath, subjectKey, pin, groups, lensName);
  }

  /**
   * Follow a lens that has been renamed.
   *
   * The stored grouping records which lens wrote it, and that record is a name.
   * Left behind, a renamed lens turns what is already on screen into something
   * the project no longer has — listed a second time, under the name it used
   * to have.
   */
  rename(projectPath: string, from: string, to: string): void {
    this.db
      .prepare('UPDATE diff_lenses SET lens_name = ? WHERE project_path = ? AND lens_name = ?')
      .run(to, projectPath, from);
  }

  delete(projectPath: string, subjectKey: string): void {
    this.db.prepare('DELETE FROM diff_lenses WHERE project_path = ? AND subject_key = ?').run(projectPath, subjectKey);
  }
}
