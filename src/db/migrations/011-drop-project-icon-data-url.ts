import type Database from 'better-sqlite3';

export function up(db: Database.Database): void {
  // The auto-detected app-icon feature was removed; the colored initials badge
  // (driven by icon_color) is now the only project icon. Drop the now-unused
  // icon_data_url column. Idempotent for re-runs.
  const columns = db.prepare("PRAGMA table_info('projects')").all() as { name: string }[];
  if (!columns.some((c) => c.name === 'icon_data_url')) return;

  db.exec(`ALTER TABLE projects DROP COLUMN icon_data_url`);
}
