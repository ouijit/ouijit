import type Database from 'better-sqlite3';

export interface ProjectRow {
  path: string;
  name: string;
  added_at: string;
  icon_data_url: string | null;
}

export class ProjectRepo {
  constructor(private db: Database.Database) {}

  getAll(): ProjectRow[] {
    return this.db.prepare('SELECT * FROM projects ORDER BY name COLLATE NOCASE').all() as ProjectRow[];
  }

  getByPath(path: string): ProjectRow | undefined {
    return this.db.prepare('SELECT * FROM projects WHERE path = ?').get(path) as ProjectRow | undefined;
  }

  add(path: string, name: string, iconDataUrl?: string): void {
    this.db.transaction(() => {
      this.db.prepare(
        'INSERT OR IGNORE INTO projects (path, name, icon_data_url) VALUES (?, ?, ?)'
      ).run(path, name, iconDataUrl ?? null);

      this.db.prepare(
        'INSERT OR IGNORE INTO project_counters (project_path) VALUES (?)'
      ).run(path);

      this.db.prepare(
        'INSERT OR IGNORE INTO project_settings (project_path) VALUES (?)'
      ).run(path);
    })();
  }

  remove(path: string): void {
    // CASCADE will clean up tasks, counters, settings, hooks
    this.db.prepare('DELETE FROM projects WHERE path = ?').run(path);
  }

  updateIcon(path: string, iconDataUrl: string | null): void {
    this.db.prepare('UPDATE projects SET icon_data_url = ? WHERE path = ?').run(iconDataUrl, path);
  }
}
