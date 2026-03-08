import type Database from 'better-sqlite3';

export interface TagRow {
  id: number;
  name: string;
}

export class TagRepo {
  constructor(private db: Database.Database) {}

  getAll(): TagRow[] {
    return this.db.prepare('SELECT * FROM tags ORDER BY name COLLATE NOCASE').all() as TagRow[];
  }

  getForTask(projectPath: string, taskNumber: number): TagRow[] {
    return this.db.prepare(`
      SELECT t.id, t.name FROM tags t
      JOIN task_tags tt ON tt.tag_id = t.id
      JOIN tasks tk ON tk.id = tt.task_id
      WHERE tk.project_path = ? AND tk.task_number = ?
      ORDER BY t.name COLLATE NOCASE
    `).all(projectPath, taskNumber) as TagRow[];
  }

  addToTask(projectPath: string, taskNumber: number, tagName: string): TagRow {
    return this.db.transaction(() => {
      const tag = this.findOrCreate(tagName);
      const task = this.db.prepare(
        'SELECT id FROM tasks WHERE project_path = ? AND task_number = ?'
      ).get(projectPath, taskNumber) as { id: number } | undefined;
      if (!task) throw new Error('Task not found');

      this.db.prepare(
        'INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)'
      ).run(task.id, tag.id);

      return tag;
    })();
  }

  removeFromTask(projectPath: string, taskNumber: number, tagName: string): void {
    this.db.prepare(`
      DELETE FROM task_tags WHERE task_id = (
        SELECT id FROM tasks WHERE project_path = ? AND task_number = ?
      ) AND tag_id = (
        SELECT id FROM tags WHERE name = ? COLLATE NOCASE
      )
    `).run(projectPath, taskNumber, tagName);
  }

  setTaskTags(projectPath: string, taskNumber: number, tagNames: string[]): TagRow[] {
    return this.db.transaction(() => {
      const task = this.db.prepare(
        'SELECT id FROM tasks WHERE project_path = ? AND task_number = ?'
      ).get(projectPath, taskNumber) as { id: number } | undefined;
      if (!task) throw new Error('Task not found');

      // Delete all existing tags for this task
      this.db.prepare('DELETE FROM task_tags WHERE task_id = ?').run(task.id);

      // Add each tag
      const tags: TagRow[] = [];
      for (const name of tagNames) {
        const tag = this.findOrCreate(name);
        this.db.prepare(
          'INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)'
        ).run(task.id, tag.id);
        tags.push(tag);
      }

      return tags;
    })();
  }

  findOrCreate(tagName: string): TagRow {
    this.db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(tagName);
    return this.db.prepare('SELECT * FROM tags WHERE name = ? COLLATE NOCASE').get(tagName) as TagRow;
  }

  pruneOrphans(): number {
    const result = this.db.prepare(`
      DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM task_tags)
    `).run();
    return result.changes;
  }
}
