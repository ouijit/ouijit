import type Database from 'better-sqlite3';

/**
 * Durable agent sessions (task #462).
 *
 * Persists the JSON-serializable {@link DurableSession} shape from
 * `src/sessions/model.ts` so a session's identity, context, and scroll-back
 * survive a full app quit. The live PTY cannot outlive the process, so on
 * restart a row here rehydrates into a DORMANT session (no process) that the
 * session manager brings back via `reattach`.
 *
 * `project_path` is intentionally NOT a foreign key to `projects(path)`: a
 * session is a durable runtime artifact whose lifetime is independent of the
 * project registry, and we never want removing a project to silently drop a
 * still-running session's record.
 */
export function up(db: Database.Database): void {
  // Idempotent for re-runs.
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").all();
  if (tables.length > 0) return;

  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      last_state TEXT NOT NULL,
      task_id INTEGER,
      worktree_path TEXT,
      label TEXT NOT NULL,
      project_path TEXT NOT NULL,
      command TEXT NOT NULL DEFAULT '',
      sandboxed INTEGER NOT NULL DEFAULT 0,
      is_runner INTEGER NOT NULL DEFAULT 0,
      parent_id TEXT,
      created_at TEXT NOT NULL,
      buffer TEXT NOT NULL DEFAULT '{"kind":"inline","chunks":[]}',
      cols INTEGER NOT NULL DEFAULT 80,
      rows INTEGER NOT NULL DEFAULT 24,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_sessions_task ON sessions(task_id);
    CREATE INDEX idx_sessions_parent ON sessions(parent_id);
  `);
}
