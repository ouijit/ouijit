import type Database from 'better-sqlite3';
import { worktreeKeyPrefix } from '../../lens/subjectKeys';

export interface DiffLensRow {
  project_path: string;
  subject_key: string;
  /** What the lens was written against. Compared, never parsed. Null until one is written. */
  pin: string | null;
  /** JSON: the groups, as the agent wrote them. */
  groups: string | null;
  /** The lens that wrote it, or null when an agent posted groups directly. */
  lens_id: string | null;
  /** What that lens was called when it ran, for once it no longer exists. */
  lens_name: string | null;
  /** Hunks listed to the agent but not quoted, because the change was too large. */
  omitted: number;
  /** The lens an agent is writing right now, or was when this process last ran. */
  running_lens_id: string | null;
  /** An ISO instant, unlike `created_at` — this one is read and formatted. */
  running_since: string | null;
  created_at: string;
}

/**
 * One lens per thing a lens can be written over. A pull request and a worktree
 * diff are the same row, told apart by the subject key, and both have at most
 * one: a second lens for the same change is a correction, not an addition.
 */
export class DiffLensRepo {
  constructor(private db: Database.Database) {}

  get(projectPath: string, subjectKey: string): DiffLensRow | undefined {
    return this.db
      .prepare('SELECT * FROM diff_lenses WHERE project_path = ? AND subject_key = ?')
      .get(projectPath, subjectKey) as DiffLensRow | undefined;
  }

  save(
    projectPath: string,
    subjectKey: string,
    pin: string,
    groups: string,
    lens: { id: string; name: string } | null,
    omitted = 0,
  ): void {
    this.db
      .prepare(
        `INSERT INTO diff_lenses (project_path, subject_key, pin, groups, lens_id, lens_name, omitted, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(project_path, subject_key) DO UPDATE SET
           pin = excluded.pin,
           groups = excluded.groups,
           lens_id = excluded.lens_id,
           lens_name = excluded.lens_name,
           omitted = excluded.omitted,
           running_lens_id = NULL,
           running_since = NULL,
           created_at = excluded.created_at`,
      )
      .run(projectPath, subjectKey, pin, groups, lens?.id ?? null, lens?.name ?? null, omitted);
  }

  /**
   * Written rather than held in memory because the process the run happens in
   * can end, and a crash mid-run is otherwise the same as never having asked.
   */
  startRun(projectPath: string, subjectKey: string, lensId: string): void {
    this.db
      .prepare(
        `INSERT INTO diff_lenses (project_path, subject_key, running_lens_id, running_since, created_at)
         VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), datetime('now'))
         ON CONFLICT(project_path, subject_key) DO UPDATE SET
           running_lens_id = excluded.running_lens_id,
           running_since = excluded.running_since`,
      )
      .run(projectPath, subjectKey, lensId);
  }

  /** However it ended. A successful `save` has already cleared it. */
  endRun(projectPath: string, subjectKey: string): void {
    this.db
      .prepare(
        `UPDATE diff_lenses SET running_lens_id = NULL, running_since = NULL
         WHERE project_path = ? AND subject_key = ?`,
      )
      .run(projectPath, subjectKey);
  }

  /**
   * Every lens written over one worktree, whatever it was compared to. Matched
   * by prefix length rather than LIKE, whose wildcards a path containing an
   * underscore would trip.
   */
  deleteForWorktree(projectPath: string, worktreePath: string): void {
    const prefix = worktreeKeyPrefix(worktreePath);
    this.db
      .prepare('DELETE FROM diff_lenses WHERE project_path = ? AND substr(subject_key, 1, ?) = ?')
      .run(projectPath, prefix.length, prefix);
  }

  delete(projectPath: string, subjectKey: string): void {
    this.db.prepare('DELETE FROM diff_lenses WHERE project_path = ? AND subject_key = ?').run(projectPath, subjectKey);
  }
}
