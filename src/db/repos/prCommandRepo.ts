import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export type PrCommandMode = 'lens' | 'terminal';

export interface PrCommandRow {
  id: string;
  project_path: string;
  name: string;
  command: string;
  mode: PrCommandMode;
  sort_order: number;
}

/**
 * Named shell commands run with a pull request's context.
 *
 * Keyed by name within a project rather than by a fixed type, because there is
 * no reason to have exactly one — "review with claude" and "security pass" are
 * both useful and both the same shape.
 */
export class PrCommandRepo {
  constructor(private db: Database.Database) {}

  getAll(projectPath: string): PrCommandRow[] {
    return this.db
      .prepare('SELECT * FROM github_pr_commands WHERE project_path = ? ORDER BY sort_order')
      .all(projectPath) as PrCommandRow[];
  }

  getByName(projectPath: string, name: string): PrCommandRow | undefined {
    return this.db
      .prepare('SELECT * FROM github_pr_commands WHERE project_path = ? AND name = ?')
      .get(projectPath, name) as PrCommandRow | undefined;
  }

  /** Upsert by name: setting an existing name edits it rather than duplicating. */
  save(projectPath: string, name: string, command: string, mode: PrCommandMode): PrCommandRow {
    const existing = this.getByName(projectPath, name);
    if (existing) {
      this.db
        .prepare('UPDATE github_pr_commands SET command = ?, mode = ? WHERE id = ?')
        .run(command, mode, existing.id);
      return this.getByName(projectPath, name)!;
    }

    const max = this.db
      .prepare('SELECT MAX(sort_order) as max_order FROM github_pr_commands WHERE project_path = ?')
      .get(projectPath) as { max_order: number | null } | undefined;

    this.db
      .prepare(
        'INSERT INTO github_pr_commands (id, project_path, name, command, mode, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(randomUUID(), projectPath, name, command, mode, (max?.max_order ?? -1) + 1);
    return this.getByName(projectPath, name)!;
  }

  delete(projectPath: string, name: string): void {
    this.db.prepare('DELETE FROM github_pr_commands WHERE project_path = ? AND name = ?').run(projectPath, name);
  }
}
