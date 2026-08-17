import type Database from 'better-sqlite3';

export interface ReviewDraftRow {
  id: string;
  project_path: string;
  pr_number: number;
  path: string;
  line: number;
  side: 'LEFT' | 'RIGHT';
  start_line: number | null;
  /** The lines the comment was written about, as the diff read at `head_sha`. */
  snippet: string | null;
  /**
   * The head its anchor was last read against.
   *
   * A draft still holding an older head than the pull request's is one the
   * re-anchor pass could not place in the new diff. Null on a draft written
   * before any of this was recorded, which is no evidence either way.
   */
  head_sha: string | null;
  body: string;
  reply_to_thread_id: string | null;
  reply_to_comment_id: number | null;
  created_at: string;
  /** Who wrote it: 'human' from the renderer, or the CLI caller's name. */
  origin: string;
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

  /**
   * An edit rewrites the body and nothing else about where the comment points.
   * The snippet is what it was written about, and `reanchor` is the only thing
   * that renumbers it.
   */
  save(row: Omit<ReviewDraftRow, 'created_at' | 'origin'> & { created_at?: string; origin?: string }): ReviewDraftRow {
    this.db
      .prepare(
        `INSERT INTO github_review_drafts
           (id, project_path, pr_number, path, line, side, start_line, snippet, head_sha, body, reply_to_thread_id, reply_to_comment_id, created_at, origin)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           body = excluded.body,
           reply_to_thread_id = excluded.reply_to_thread_id,
           reply_to_comment_id = excluded.reply_to_comment_id,
           origin = excluded.origin`,
      )
      .run(
        row.id,
        row.project_path,
        row.pr_number,
        row.path,
        row.line,
        row.side,
        row.start_line,
        row.snippet,
        row.head_sha,
        row.body,
        row.reply_to_thread_id,
        row.reply_to_comment_id,
        row.created_at ?? new Date().toISOString(),
        row.origin ?? 'human',
      );
    return this.get(row.id)!;
  }

  reanchor(id: string, startLine: number, line: number, headSha: string): void {
    this.db
      .prepare('UPDATE github_review_drafts SET start_line = ?, line = ?, head_sha = ? WHERE id = ?')
      .run(startLine, line, headSha, id);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM github_review_drafts WHERE id = ?').run(id);
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
