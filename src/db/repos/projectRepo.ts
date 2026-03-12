import type Database from 'better-sqlite3';

export interface ProjectRow {
  path: string;
  name: string;
  added_at: string;
  icon_data_url: string | null;
  sort_order: number;
}

export class ProjectRepo {
  constructor(private db: Database.Database) {}

  getAll(): ProjectRow[] {
    return this.db.prepare('SELECT * FROM projects ORDER BY sort_order, name COLLATE NOCASE').all() as ProjectRow[];
  }

  getByPath(path: string): ProjectRow | undefined {
    return this.db.prepare('SELECT * FROM projects WHERE path = ?').get(path) as ProjectRow | undefined;
  }

  add(path: string, name: string, iconDataUrl?: string): void {
    this.db.transaction(() => {
      this.db
        .prepare('INSERT OR IGNORE INTO projects (path, name, icon_data_url) VALUES (?, ?, ?)')
        .run(path, name, iconDataUrl ?? null);

      this.db.prepare('INSERT OR IGNORE INTO project_counters (project_path) VALUES (?)').run(path);

      this.db.prepare('INSERT OR IGNORE INTO project_settings (project_path) VALUES (?)').run(path);
    })();
  }

  remove(path: string): void {
    // CASCADE will clean up tasks, counters, settings, hooks
    this.db.prepare('DELETE FROM projects WHERE path = ?').run(path);
  }

  /** Reorder projects by setting sort_order based on the given path order */
  reorder(paths: string[]): void {
    const stmt = this.db.prepare('UPDATE projects SET sort_order = ? WHERE path = ?');
    this.db.transaction(() => {
      for (let i = 0; i < paths.length; i++) {
        stmt.run(i, paths[i]);
      }
    })();
  }
}
