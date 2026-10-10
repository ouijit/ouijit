import type Database from 'better-sqlite3';

/**
 * The sandbox backend a hook's terminal runs under. NULL is a host shell.
 */
export function up(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info('hooks')").all() as { name: string }[];
  if (!cols.some((c) => c.name === 'sandbox')) {
    db.exec(`ALTER TABLE hooks ADD COLUMN sandbox TEXT`);
  }
}
