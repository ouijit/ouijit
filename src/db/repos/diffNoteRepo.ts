import type Database from 'better-sqlite3';

export interface DiffNoteRow {
  id: string;
  worktree_path: string;
  path: string;
  line: number;
  side: 'LEFT' | 'RIGHT';
  line_text: string | null;
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

  get(id: string): DiffNoteRow | undefined {
    return this.db.prepare('SELECT * FROM diff_notes WHERE id = ?').get(id) as DiffNoteRow | undefined;
  }

  save(row: DiffNoteRow): DiffNoteRow {
    this.db
      .prepare(
        `INSERT INTO diff_notes (id, worktree_path, path, line, side, line_text, body, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           path = excluded.path,
           line = excluded.line,
           side = excluded.side,
           line_text = excluded.line_text,
           body = excluded.body`,
      )
      .run(row.id, row.worktree_path, row.path, row.line, row.side, row.line_text, row.body, row.created_at);
    return this.get(row.id)!;
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM diff_notes WHERE id = ?').run(id);
  }

  /** Discard all of a worktree's notes at once, once they have been handed over. */
  deleteForWorktree(worktreePath: string): void {
    this.db.prepare('DELETE FROM diff_notes WHERE worktree_path = ?').run(worktreePath);
  }
}
