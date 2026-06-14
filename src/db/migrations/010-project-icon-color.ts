import type Database from 'better-sqlite3';

export function up(db: Database.Database): void {
  // Check if column already exists (idempotent for re-runs)
  const columns = db.prepare("PRAGMA table_info('projects')").all() as { name: string }[];
  if (columns.some((c) => c.name === 'icon_color')) return;

  // Nullable: a null icon_color means "use the color generated from the project name".
  db.exec(`ALTER TABLE projects ADD COLUMN icon_color TEXT`);
}
