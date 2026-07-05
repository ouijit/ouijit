import type Database from 'better-sqlite3';

/**
 * Drop the dead `tasks.sandboxed` boolean. Sandboxing is a property of a
 * terminal, not a task: an agent's sandboxed terminal and a user's host
 * terminal can coexist on one task, so no per-task sandbox column reflects
 * reality. The backend is chosen per terminal at open time and ensured lazily
 * by the provider. Idempotent: guarded on column presence.
 */
export function up(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info('tasks')").all() as { name: string }[];
  if (columns.some((c) => c.name === 'sandboxed')) {
    db.exec('ALTER TABLE tasks DROP COLUMN sandboxed');
  }
}
