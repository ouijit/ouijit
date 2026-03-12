import type Database from 'better-sqlite3';

export interface SettingsRow {
  project_path: string;
  kill_existing_on_run: number;
  sandbox_memory_gib: number | null;
  sandbox_disk_gib: number | null;
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
    const sandboxMem = settings.sandbox_memory_gib ?? current?.sandbox_memory_gib ?? null;
    const sandboxDisk = settings.sandbox_disk_gib ?? current?.sandbox_disk_gib ?? null;

    this.db
      .prepare(
        `
      INSERT INTO project_settings (project_path, kill_existing_on_run, sandbox_memory_gib, sandbox_disk_gib)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(project_path) DO UPDATE SET
        kill_existing_on_run = excluded.kill_existing_on_run,
        sandbox_memory_gib = excluded.sandbox_memory_gib,
        sandbox_disk_gib = excluded.sandbox_disk_gib
    `,
      )
      .run(projectPath, killExisting, sandboxMem, sandboxDisk);
  }
}
