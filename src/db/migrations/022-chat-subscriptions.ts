import type Database from 'better-sqlite3';

/**
 * What each of Chat's conversations follows: a task, by `taskKey`, or a chat
 * with no task, by its session id. One conversation follows a thing at a time.
 * No reference to `chat_sessions`: a conversation follows what it starts
 * before its own row is first written.
 */
export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE chat_subscriptions (
      subject TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL
    );
  `);
}
