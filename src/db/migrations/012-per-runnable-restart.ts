import type Database from 'better-sqlite3';

/**
 * Replace the project-global `kill_existing_on_run` flag with a per-runnable
 * "restart if already running" flag on each script and hook (default off). The
 * old flag lived in `project_settings`, which had already been whittled down to
 * that single column (sandbox config was dropped in 007), so the table is
 * dropped entirely here. Idempotent for re-runs.
 */
export function up(db: Database.Database): void {
  const scriptCols = db.prepare("PRAGMA table_info('scripts')").all() as { name: string }[];
  if (!scriptCols.some((c) => c.name === 'restart_if_running')) {
    db.exec(`ALTER TABLE scripts ADD COLUMN restart_if_running INTEGER NOT NULL DEFAULT 0`);
  }

  const hookCols = db.prepare("PRAGMA table_info('hooks')").all() as { name: string }[];
  if (!hookCols.some((c) => c.name === 'restart_if_running')) {
    db.exec(`ALTER TABLE hooks ADD COLUMN restart_if_running INTEGER NOT NULL DEFAULT 0`);
  }

  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='project_settings'").all();
  if (tables.length > 0) {
    db.exec(`DROP TABLE project_settings`);
  }
}
