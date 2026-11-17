import type Database from 'better-sqlite3';

/**
 * A session's `role` is what the API trusts to grant Chat its reach, so it is
 * stored rather than read off the id. A subscription has no reference to
 * `chat_sessions`: a conversation follows what it starts before its own row is
 * first written.
 */
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
      updated_at TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'card'
    );
    CREATE INDEX idx_chat_sessions_task ON chat_sessions (project_path, task_id);

    CREATE TABLE chat_nodes (
      session_id TEXT NOT NULL REFERENCES chat_sessions (id) ON DELETE CASCADE,
      node_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      body TEXT NOT NULL,
      PRIMARY KEY (session_id, node_id)
    );

    CREATE TABLE chat_task_owners (
      project_path TEXT NOT NULL,
      task_number INTEGER NOT NULL,
      chat_id TEXT NOT NULL REFERENCES chat_sessions (id) ON DELETE CASCADE,
      PRIMARY KEY (project_path, task_number)
    );

    CREATE TABLE chat_subscriptions (
      subject TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL
    );
  `);
}
