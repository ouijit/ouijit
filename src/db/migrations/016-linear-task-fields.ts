import type Database from 'better-sqlite3';

/**
 * What a task remembers about the Linear issue it came from.
 *
 * The identifier is stored rather than fetched so a kanban badge can render
 * `ENG-123` offline; it goes stale if an issue changes team, and is corrected
 * on the next read. `suggested_branch` is provider-neutral: it holds whatever
 * branch name the task was created with, read at start time so starting a task
 * costs no round trip and works offline.
 */
export function up(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info('tasks')").all() as { name: string }[];
  const has = (name: string) => columns.some((c) => c.name === name);

  if (!has('linear_issue_id')) db.exec('ALTER TABLE tasks ADD COLUMN linear_issue_id TEXT');
  if (!has('linear_issue_identifier')) db.exec('ALTER TABLE tasks ADD COLUMN linear_issue_identifier TEXT');
  if (!has('suggested_branch')) db.exec('ALTER TABLE tasks ADD COLUMN suggested_branch TEXT');
}
