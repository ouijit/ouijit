import type Database from 'better-sqlite3';

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS automations (
      id TEXT PRIMARY KEY,
      project_path TEXT NOT NULL REFERENCES projects(path) ON DELETE CASCADE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      prompt TEXT,
      command TEXT,
      schedule TEXT,
      missed TEXT NOT NULL DEFAULT 'run-once',
      location TEXT NOT NULL DEFAULT 'worktree',
      sandbox TEXT NOT NULL DEFAULT 'nono',
      paused INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      next_run_at TEXT,
      UNIQUE (project_path, name)
    );

    CREATE TABLE IF NOT EXISTS automation_runs (
      id TEXT PRIMARY KEY,
      automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
      project_path TEXT NOT NULL,
      state TEXT NOT NULL,
      trigger TEXT NOT NULL,
      summary TEXT,
      reason TEXT,
      scheduled_for TEXT,
      started_at TEXT,
      ended_at TEXT,
      exit_code INTEGER,
      worktree_path TEXT,
      branch TEXT,
      base_commit TEXT,
      merge_target TEXT,
      output TEXT,
      unread INTEGER NOT NULL DEFAULT 0,
      task_number INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_automation_runs_automation ON automation_runs(automation_id, created_at);
  `);
}
