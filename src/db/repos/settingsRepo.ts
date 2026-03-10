import type Database from 'better-sqlite3';

export interface SettingsRow {
  project_path: string;
  kill_existing_on_run: number;
  sandbox_memory_gib: number | null;
  sandbox_disk_gib: number | null;
  terminal_layout: string | null;
  grid_ratios: string | null;
}

export class SettingsRepo {
  constructor(private db: Database.Database) {}

  get(projectPath: string): SettingsRow | undefined {
    return this.db.prepare(
      'SELECT * FROM project_settings WHERE project_path = ?'
    ).get(projectPath) as SettingsRow | undefined;
  }

  update(projectPath: string, settings: Partial<Omit<SettingsRow, 'project_path'>>): void {
    const current = this.get(projectPath);

    const killExisting = settings.kill_existing_on_run ?? current?.kill_existing_on_run ?? 0;
    const sandboxMem = settings.sandbox_memory_gib ?? current?.sandbox_memory_gib ?? null;
    const sandboxDisk = settings.sandbox_disk_gib ?? current?.sandbox_disk_gib ?? null;
    const terminalLayout = settings.terminal_layout ?? current?.terminal_layout ?? null;
    const gridRatios = settings.grid_ratios ?? current?.grid_ratios ?? null;

    this.db.prepare(`
      INSERT INTO project_settings (project_path, kill_existing_on_run, sandbox_memory_gib, sandbox_disk_gib, terminal_layout, grid_ratios)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_path) DO UPDATE SET
        kill_existing_on_run = excluded.kill_existing_on_run,
        sandbox_memory_gib = excluded.sandbox_memory_gib,
        sandbox_disk_gib = excluded.sandbox_disk_gib,
        terminal_layout = excluded.terminal_layout,
        grid_ratios = excluded.grid_ratios
    `).run(projectPath, killExisting, sandboxMem, sandboxDisk, terminalLayout, gridRatios);
  }
}
