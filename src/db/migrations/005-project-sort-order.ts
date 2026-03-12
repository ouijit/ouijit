import type Database from 'better-sqlite3';

export function up(db: Database.Database): void {
  // Check if column already exists (idempotent for re-runs)
  const columns = db.prepare("PRAGMA table_info('projects')").all() as { name: string }[];
  if (columns.some((c) => c.name === 'sort_order')) return;

  db.exec(`ALTER TABLE projects ADD COLUMN sort_order INTEGER DEFAULT 0`);

  // Initialize sort_order based on current alphabetical order
  const rows = db.prepare('SELECT path FROM projects ORDER BY name COLLATE NOCASE').all() as { path: string }[];
  const stmt = db.prepare('UPDATE projects SET sort_order = ? WHERE path = ?');
  for (let i = 0; i < rows.length; i++) {
    stmt.run(i, rows[i].path);
  }
}
