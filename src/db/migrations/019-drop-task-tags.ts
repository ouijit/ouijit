import type Database from 'better-sqlite3';

/**
 * Tags belong to terminals, which persist through the session snapshot rather
 * than the database. Task tags are dropped, not carried over.
 */
export function up(db: Database.Database): void {
  db.exec(`
    DROP TABLE IF EXISTS task_tags;
    DROP TABLE IF EXISTS tags;
  `);
}
