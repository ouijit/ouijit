import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export interface ScriptRow {
  id: string;
  project_path: string;
  name: string;
  command: string;
  sort_order: number;
}

export class ScriptRepo {
  constructor(private db: Database.Database) {}

  getAll(projectPath: string): ScriptRow[] {
    return this.db
      .prepare('SELECT * FROM scripts WHERE project_path = ? ORDER BY sort_order')
      .all(projectPath) as ScriptRow[];
  }

  save(projectPath: string, name: string, command: string, id?: string): ScriptRow {
    const scriptId = id ?? randomUUID();

    // For new scripts, assign sort_order after the last existing one
    const maxOrder = this.db
      .prepare('SELECT MAX(sort_order) as max_order FROM scripts WHERE project_path = ?')
      .get(projectPath) as { max_order: number | null } | undefined;
    const nextOrder = (maxOrder?.max_order ?? -1) + 1;

    this.db
      .prepare(
        `
      INSERT INTO scripts (id, project_path, name, command, sort_order)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        command = excluded.command
    `,
      )
      .run(scriptId, projectPath, name, command, nextOrder);

    return this.db.prepare('SELECT * FROM scripts WHERE id = ?').get(scriptId) as ScriptRow;
  }

  delete(projectPath: string, scriptId: string): void {
    this.db.prepare('DELETE FROM scripts WHERE id = ? AND project_path = ?').run(scriptId, projectPath);
  }

  reorder(projectPath: string, scriptIds: string[]): void {
    const stmt = this.db.prepare('UPDATE scripts SET sort_order = ? WHERE id = ? AND project_path = ?');
    this.db.transaction(() => {
      for (let i = 0; i < scriptIds.length; i++) {
        stmt.run(i, scriptIds[i], projectPath);
      }
    })();
  }
}
