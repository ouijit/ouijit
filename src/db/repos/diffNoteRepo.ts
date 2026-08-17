import type Database from 'better-sqlite3';

export interface DiffNoteRow {
  id: string;
  worktree_path: string;
  path: string;
  line: number;
  start_line: number | null;
  side: 'LEFT' | 'RIGHT';
  snippet: string | null;
  body: string;
  created_at: string;
}

/**
 * Notes on a worktree's diff, waiting to be handed to the agent working in it.
 *
 * Ordered by file and line rather than by write time, so the list matches the
 * order the notes appear in the diff.
 */
export class DiffNoteRepo {
  constructor(private db: Database.Database) {}

  getForWorktree(worktreePath: string): DiffNoteRow[] {
    return this.db
      .prepare('SELECT * FROM diff_notes WHERE worktree_path = ? ORDER BY path, line, created_at')
      .all(worktreePath) as DiffNoteRow[];
  }

  /**
   * An edit rewrites the body and nothing else. Where a note points is not the
   * writer's to change after the fact — the snippet is what it was written
   * about, and `move` is the only thing that renumbers it.
   */
  save(row: DiffNoteRow): void {
    this.db
      .prepare(
        `INSERT INTO diff_notes (id, worktree_path, path, line, start_line, side, snippet, body, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET body = excluded.body`,
      )
      .run(
        row.id,
        row.worktree_path,
        row.path,
        row.line,
        row.start_line,
        row.side,
        row.snippet,
        row.body,
        row.created_at,
      );
  }

  move(id: string, startLine: number, line: number): void {
    this.db.prepare('UPDATE diff_notes SET start_line = ?, line = ? WHERE id = ?').run(startLine, line, id);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM diff_notes WHERE id = ?').run(id);
  }

  deleteMany(ids: readonly string[]): void {
    if (ids.length === 0) return;
    const drop = this.db.prepare('DELETE FROM diff_notes WHERE id = ?');
    this.db.transaction((all: readonly string[]) => all.forEach((id) => drop.run(id)))(ids);
  }

  deleteForWorktree(worktreePath: string): void {
    this.db.prepare('DELETE FROM diff_notes WHERE worktree_path = ?').run(worktreePath);
  }
}
