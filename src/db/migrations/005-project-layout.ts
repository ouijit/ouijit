import type Database from 'better-sqlite3';

export function up(db: Database.Database): void {
  db.exec(`ALTER TABLE project_settings ADD COLUMN terminal_layout TEXT`);
  db.exec(`ALTER TABLE project_settings ADD COLUMN grid_ratios TEXT`);
}
