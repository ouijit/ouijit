import type Database from 'better-sqlite3';

export class GlobalSettingsRepo {
  constructor(private db: Database.Database) {}

  get(key: string): string | undefined {
    const row = this.db.prepare(
      'SELECT value FROM global_settings WHERE key = ?'
    ).get(key) as { value: string } | undefined;
    return row?.value;
  }

  set(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO global_settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
  }
}
