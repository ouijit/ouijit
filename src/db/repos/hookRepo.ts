import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export type HookType = 'start' | 'continue' | 'run' | 'review' | 'done' | 'editor';

export interface HookRow {
  id: string;
  project_path: string;
  type: HookType;
  name: string;
  command: string;
  description: string | null;
  restart_if_running: number;
}

export class HookRepo {
  constructor(private db: Database.Database) {}

  getForProject(projectPath: string): HookRow[] {
    return this.db.prepare('SELECT * FROM hooks WHERE project_path = ? ORDER BY type').all(projectPath) as HookRow[];
  }

  getByType(projectPath: string, type: HookType): HookRow | undefined {
    return this.db.prepare('SELECT * FROM hooks WHERE project_path = ? AND type = ?').get(projectPath, type) as
      | HookRow
      | undefined;
  }

  save(
    projectPath: string,
    type: HookType,
    name: string,
    command: string,
    id?: string,
    description?: string,
    restartIfRunning = false,
  ): HookRow {
    const hookId = id ?? randomUUID();

    this.db
      .prepare(
        `
      INSERT INTO hooks (id, project_path, type, name, command, description, restart_if_running)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_path, type) DO UPDATE SET
        id = excluded.id,
        name = excluded.name,
        command = excluded.command,
        description = excluded.description,
        restart_if_running = excluded.restart_if_running
    `,
      )
      .run(hookId, projectPath, type, name, command, description ?? null, restartIfRunning ? 1 : 0);

    return this.getByType(projectPath, type)!;
  }

  deleteByType(projectPath: string, type: HookType): void {
    this.db.prepare('DELETE FROM hooks WHERE project_path = ? AND type = ?').run(projectPath, type);
  }
}
