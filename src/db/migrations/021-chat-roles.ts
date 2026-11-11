import type Database from 'better-sqlite3';

/**
 * A session's role is what the API trusts to grant Chat its reach, so it is
 * stored rather than read off the id. Chat's conversations had ids under
 * `home-`, and one under `chat` predates them.
 */
export function up(db: Database.Database): void {
  db.exec(`
    ALTER TABLE chat_sessions ADD COLUMN role TEXT NOT NULL DEFAULT 'card';
    UPDATE chat_sessions SET role = 'home' WHERE id LIKE 'home-%';
    DELETE FROM chat_sessions WHERE id = 'chat';

    CREATE TABLE chat_task_owners (
      project_path TEXT NOT NULL,
      task_number INTEGER NOT NULL,
      chat_id TEXT NOT NULL REFERENCES chat_sessions (id) ON DELETE CASCADE,
      PRIMARY KEY (project_path, task_number)
    );
  `);
}
