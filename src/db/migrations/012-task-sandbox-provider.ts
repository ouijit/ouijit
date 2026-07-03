import type Database from 'better-sqlite3';

/**
 * Replace the boolean `tasks.sandboxed` flag with a `sandbox_provider` id so a
 * task can pick which sandbox backend runs its terminals ('none' | 'lima' |
 * 'nono'). Existing sandboxed tasks were all Lima, so they migrate to 'lima'.
 * Idempotent: guarded on column presence for re-runs.
 */
export function up(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info('tasks')").all() as { name: string }[];
  const hasSandboxed = columns.some((c) => c.name === 'sandboxed');
  const hasProvider = columns.some((c) => c.name === 'sandbox_provider');

  if (!hasProvider) {
    db.exec("ALTER TABLE tasks ADD COLUMN sandbox_provider TEXT NOT NULL DEFAULT 'none'");
  }
  if (hasSandboxed) {
    db.exec("UPDATE tasks SET sandbox_provider = 'lima' WHERE sandboxed = 1");
    db.exec('ALTER TABLE tasks DROP COLUMN sandboxed');
  }
}
