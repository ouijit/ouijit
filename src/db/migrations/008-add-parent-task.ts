import type Database from 'better-sqlite3';

export function up(db: Database.Database): void {
  db.exec('ALTER TABLE tasks ADD COLUMN parent_task_number INTEGER');
}
