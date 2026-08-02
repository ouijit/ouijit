import type Database from 'better-sqlite3';

export interface ReviewDraftRow {
  id: string;
  project_path: string;
  pr_number: number;
  path: string;
  line: number;
  side: 'LEFT' | 'RIGHT';
  start_line: number | null;
  body: string;
  reply_to_thread_id: string | null;
  reply_to_comment_id: number | null;
  created_at: string;
}

/**
 * Unsubmitted review comments. Everything is keyed by (project_path, pr_number)
 * so drafts written in an ephemeral session for a teammate's PR — one with no
 * task behind it — persist the same way a task-backed review's do.
 */
export class ReviewDraftRepo {
  constructor(private db: Database.Database) {}

  getForPr(projectPath: string, prNumber: number): ReviewDraftRow[] {
    return this.db
      .prepare(
        'SELECT * FROM github_review_drafts WHERE project_path = ? AND pr_number = ? ORDER BY path, line, created_at',
      )
      .all(projectPath, prNumber) as ReviewDraftRow[];
  }

  get(id: string): ReviewDraftRow | undefined {
    return this.db.prepare('SELECT * FROM github_review_drafts WHERE id = ?').get(id) as ReviewDraftRow | undefined;
  }

  save(row: Omit<ReviewDraftRow, 'created_at'> & { created_at?: string }): ReviewDraftRow {
    this.db
      .prepare(
        `INSERT INTO github_review_drafts
           (id, project_path, pr_number, path, line, side, start_line, body, reply_to_thread_id, reply_to_comment_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           path = excluded.path,
           line = excluded.line,
           side = excluded.side,
           start_line = excluded.start_line,
           body = excluded.body,
           reply_to_thread_id = excluded.reply_to_thread_id,
           reply_to_comment_id = excluded.reply_to_comment_id`,
      )
      .run(
        row.id,
        row.project_path,
        row.pr_number,
        row.path,
        row.line,
        row.side,
        row.start_line,
        row.body,
        row.reply_to_thread_id,
        row.reply_to_comment_id,
        row.created_at ?? new Date().toISOString(),
      );
    return this.get(row.id)!;
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM github_review_drafts WHERE id = ?').run(id);
  }

  /** Clear a PR's drafts — called after a review is submitted successfully. */
  deleteForPr(projectPath: string, prNumber: number): void {
    this.db
      .prepare('DELETE FROM github_review_drafts WHERE project_path = ? AND pr_number = ?')
      .run(projectPath, prNumber);
  }

  /** Draft counts per PR, so the inbox can badge which PRs have work in progress. */
  countsByPr(projectPath: string): Map<number, number> {
    const rows = this.db
      .prepare(
        'SELECT pr_number, COUNT(*) as count FROM github_review_drafts WHERE project_path = ? GROUP BY pr_number',
      )
      .all(projectPath) as { pr_number: number; count: number }[];
    return new Map(rows.map((r) => [r.pr_number, r.count]));
  }
}
