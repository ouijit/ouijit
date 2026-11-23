import type Database from 'better-sqlite3';

/** What the branch a task merges into, and its remote-tracking refs, pointed at when the task's worktree was made. */
export function up(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info('tasks')").all() as { name: string }[];
  if (!columns.some((c) => c.name === 'protected_refs')) db.exec('ALTER TABLE tasks ADD COLUMN protected_refs TEXT');
}
