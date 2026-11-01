import type Database from 'better-sqlite3';

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE chat_sessions (
      id TEXT PRIMARY KEY,
      project_path TEXT NOT NULL,
      task_id INTEGER,
      cwd TEXT NOT NULL,
      worktree_path TEXT,
      agent TEXT NOT NULL,
      agent_session_id TEXT,
      sandbox_provider TEXT,
      info TEXT NOT NULL,
      seq INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_chat_sessions_task ON chat_sessions (project_path, task_id);

    CREATE TABLE chat_nodes (
      session_id TEXT NOT NULL REFERENCES chat_sessions (id) ON DELETE CASCADE,
      node_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      body TEXT NOT NULL,
      PRIMARY KEY (session_id, node_id)
    );
  `);
}
