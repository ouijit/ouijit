import type Database from 'better-sqlite3';

/**
 * Global-settings keys of the form `<prefix><projectPath>`. Must stay in sync
 * with the renderer stores that write them: canvasStore ('canvas:'),
 * worktreeSettingsStore ('worktree:'), experimentalStore ('experimental:').
 * Any new path-keyed setting prefix must be added here so updatePath migrates it.
 */
const PATH_KEYED_SETTING_PREFIXES = ['canvas:', 'worktree:', 'experimental:'];

export interface ProjectRow {
  path: string;
  name: string;
  added_at: string;
  icon_data_url: string | null;
  sort_order: number;
}

export class ProjectRepo {
  constructor(private db: Database.Database) {}

  getAll(): ProjectRow[] {
    return this.db.prepare('SELECT * FROM projects ORDER BY sort_order, name COLLATE NOCASE').all() as ProjectRow[];
  }

  getByPath(path: string): ProjectRow | undefined {
    return this.db.prepare('SELECT * FROM projects WHERE path = ?').get(path) as ProjectRow | undefined;
  }

  add(path: string, name: string, iconDataUrl?: string): void {
    this.db.transaction(() => {
      this.db
        .prepare('INSERT OR IGNORE INTO projects (path, name, icon_data_url) VALUES (?, ?, ?)')
        .run(path, name, iconDataUrl ?? null);

      this.db.prepare('INSERT OR IGNORE INTO project_counters (project_path) VALUES (?)').run(path);

      this.db.prepare('INSERT OR IGNORE INTO project_settings (project_path) VALUES (?)').run(path);
    })();
  }

  remove(path: string): void {
    // CASCADE will clean up tasks, counters, settings, hooks
    this.db.prepare('DELETE FROM projects WHERE path = ?').run(path);
  }

  /**
   * Rewrites a project's path everywhere it's stored. The path is the primary
   * key referenced by every per-project table (no ON UPDATE CASCADE), so all
   * tables update in one transaction with foreign-key checks deferred to commit.
   * Path-keyed global_settings rows migrate in the same transaction.
   */
  updatePath(oldPath: string, newPath: string): void {
    this.db.transaction(() => {
      // Resets automatically at the end of this transaction.
      this.db.pragma('defer_foreign_keys = ON');
      this.db.prepare('UPDATE projects SET path = ? WHERE path = ?').run(newPath, oldPath);
      this.db.prepare('UPDATE tasks SET project_path = ? WHERE project_path = ?').run(newPath, oldPath);
      this.db.prepare('UPDATE project_counters SET project_path = ? WHERE project_path = ?').run(newPath, oldPath);
      this.db.prepare('UPDATE project_settings SET project_path = ? WHERE project_path = ?').run(newPath, oldPath);
      this.db.prepare('UPDATE hooks SET project_path = ? WHERE project_path = ?').run(newPath, oldPath);
      this.db.prepare('UPDATE scripts SET project_path = ? WHERE project_path = ?').run(newPath, oldPath);
      // OR REPLACE: if a row already exists under the new path, the old one wins.
      const renameSetting = this.db.prepare('UPDATE OR REPLACE global_settings SET key = ? WHERE key = ?');
      for (const prefix of PATH_KEYED_SETTING_PREFIXES) {
        renameSetting.run(prefix + newPath, prefix + oldPath);
      }
    })();
  }

  /** Reorder projects by setting sort_order based on the given path order */
  reorder(paths: string[]): void {
    const stmt = this.db.prepare('UPDATE projects SET sort_order = ? WHERE path = ?');
    this.db.transaction(() => {
      for (let i = 0; i < paths.length; i++) {
        stmt.run(i, paths[i]);
      }
    })();
  }
}
