import type Database from 'better-sqlite3';

export interface PrLensRow {
  project_path: string;
  pr_number: number;
  head_sha: string;
  /** JSON: the groups, as written. Parsed and reconciled on the way out. */
  groups: string;
  created_at: string;
}

/**
 * One reading order per pull request.
 *
 * A pull request has at most one, replaced rather than accumulated: a second
 * lens for the same change is a correction, not an addition. Reads are
 * filtered by head SHA at the service layer rather than by adding it to the key,
 * so a stale row is dropped on the next write instead of lingering per head.
 */
export class PrLensRepo {
  constructor(private db: Database.Database) {}

  get(projectPath: string, prNumber: number): PrLensRow | undefined {
    return this.db
      .prepare('SELECT * FROM github_pr_lenses WHERE project_path = ? AND pr_number = ?')
      .get(projectPath, prNumber) as PrLensRow | undefined;
  }

  save(projectPath: string, prNumber: number, headSha: string, groups: string): void {
    this.db
      .prepare(
        `INSERT INTO github_pr_lenses (project_path, pr_number, head_sha, groups, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(project_path, pr_number) DO UPDATE SET
           head_sha = excluded.head_sha,
           groups = excluded.groups,
           created_at = excluded.created_at`,
      )
      .run(projectPath, prNumber, headSha, groups, new Date().toISOString());
  }

  delete(projectPath: string, prNumber: number): void {
    this.db.prepare('DELETE FROM github_pr_lenses WHERE project_path = ? AND pr_number = ?').run(projectPath, prNumber);
  }
}
