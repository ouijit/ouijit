import type Database from 'better-sqlite3';

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE projects (
      path TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      icon_data_url TEXT
    );

    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_path TEXT NOT NULL REFERENCES projects(path) ON DELETE CASCADE,
      task_number INTEGER NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'in_review', 'done')),
      prompt TEXT,
      branch TEXT,
      worktree_path TEXT,
      merge_target TEXT,
      sandboxed INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      closed_at TEXT,
      UNIQUE(project_path, task_number)
    );
    CREATE INDEX idx_tasks_project_status ON tasks(project_path, status);

    CREATE TABLE project_counters (
      project_path TEXT PRIMARY KEY REFERENCES projects(path) ON DELETE CASCADE,
      next_task_number INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE project_settings (
      project_path TEXT PRIMARY KEY REFERENCES projects(path) ON DELETE CASCADE,
      kill_existing_on_run INTEGER NOT NULL DEFAULT 1,
      sandbox_memory_gib INTEGER,
      sandbox_disk_gib INTEGER
    );

    CREATE TABLE hooks (
      id TEXT PRIMARY KEY,
      project_path TEXT NOT NULL REFERENCES projects(path) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('start', 'continue', 'run', 'cleanup', 'sandbox-setup', 'editor')),
      name TEXT NOT NULL,
      command TEXT NOT NULL,
      description TEXT,
      UNIQUE(project_path, type)
    );
  `);
}
