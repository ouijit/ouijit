import type Database from 'better-sqlite3';

export interface SettingsRow {
  project_path: string;
  kill_existing_on_run: number;
}

export class SettingsRepo {
  constructor(private db: Database.Database) {}

  get(projectPath: string): SettingsRow | undefined {
    return this.db.prepare('SELECT * FROM project_settings WHERE project_path = ?').get(projectPath) as
      | SettingsRow
      | undefined;
  }

  update(projectPath: string, settings: Partial<Omit<SettingsRow, 'project_path'>>): void {
    const current = this.get(projectPath);

    const killExisting = settings.kill_existing_on_run ?? current?.kill_existing_on_run ?? 0;

    this.db
      .prepare(
        `
      INSERT INTO project_settings (project_path, kill_existing_on_run)
      VALUES (?, ?)
      ON CONFLICT(project_path) DO UPDATE SET
        kill_existing_on_run = excluded.kill_existing_on_run
    `,
      )
      .run(projectPath, killExisting);
  }
}
