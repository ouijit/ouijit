import type Database from 'better-sqlite3';

/** A chat's sandbox as one JSON spec, `{ provider, settings }`; NULL is the host. */
export function up(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info('chat_sessions')").all() as { name: string }[];
  if (cols.some((c) => c.name === 'sandbox')) return;
  db.exec(`
    ALTER TABLE chat_sessions ADD COLUMN sandbox TEXT;
    UPDATE chat_sessions SET sandbox = json_object('provider', sandbox_provider, 'settings', project_path)
      WHERE sandbox_provider IN ('nono', 'custom');
    ALTER TABLE chat_sessions DROP COLUMN sandbox_provider;
  `);
}
