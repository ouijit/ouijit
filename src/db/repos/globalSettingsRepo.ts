import type Database from 'better-sqlite3';

export class GlobalSettingsRepo {
  private getStmt: Database.Statement;
  private setStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.getStmt = db.prepare('SELECT value FROM global_settings WHERE key = ?');
    this.setStmt = db.prepare(`
      INSERT INTO global_settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
  }

  get(key: string): string | undefined {
    const row = this.getStmt.get(key) as { value: string } | undefined;
    return row?.value;
  }

  set(key: string, value: string): void {
    this.setStmt.run(key, value);
  }
}
