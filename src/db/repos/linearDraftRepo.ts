import type Database from 'better-sqlite3';

export interface LinearDraftRow {
  id: string;
  project_path: string;
  issue_id: string;
  body: string;
  /** Who wrote it: 'human' from the renderer, or the CLI caller's name. */
  origin: string;
  created_at: string;
}

/** Comments written against a Linear issue and held until a person sends them. */
export class LinearDraftRepo {
  constructor(private db: Database.Database) {}

  getForIssue(projectPath: string, issueId: string): LinearDraftRow[] {
    return this.db
      .prepare('SELECT * FROM linear_comment_drafts WHERE project_path = ? AND issue_id = ? ORDER BY created_at')
      .all(projectPath, issueId) as LinearDraftRow[];
  }

  /**
   * Scoped to the project, not looked up by id alone: a draft id is guessable,
   * and a sandboxed caller holds a token good for one project.
   */
  find(projectPath: string, id: string): LinearDraftRow | undefined {
    return this.db
      .prepare('SELECT * FROM linear_comment_drafts WHERE project_path = ? AND id = ?')
      .get(projectPath, id) as LinearDraftRow | undefined;
  }

  getForProject(projectPath: string): LinearDraftRow[] {
    return this.db
      .prepare('SELECT * FROM linear_comment_drafts WHERE project_path = ? ORDER BY created_at')
      .all(projectPath) as LinearDraftRow[];
  }

  save(row: Omit<LinearDraftRow, 'created_at' | 'origin'> & { origin?: string }): LinearDraftRow {
    this.db
      .prepare(
        `INSERT INTO linear_comment_drafts (id, project_path, issue_id, body, origin)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(row.id, row.project_path, row.issue_id, row.body, row.origin ?? 'human');
    return this.db.prepare('SELECT * FROM linear_comment_drafts WHERE id = ?').get(row.id) as LinearDraftRow;
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM linear_comment_drafts WHERE id = ?').run(id);
  }
}
