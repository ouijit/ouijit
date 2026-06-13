import type Database from 'better-sqlite3';
import type { DurableSession, DurableBufferRef, SessionState } from '../../sessions/model';

interface SessionRow {
  id: string;
  last_state: string;
  task_id: number | null;
  worktree_path: string | null;
  label: string;
  project_path: string;
  command: string;
  sandboxed: number;
  is_runner: number;
  parent_id: string | null;
  created_at: string;
  buffer: string;
  cols: number;
  rows: number;
}

/**
 * Persistence for {@link DurableSession} records (task #462).
 *
 * The buffer is stored as a JSON-encoded {@link DurableBufferRef} in a single
 * column; the rest of the columns mirror the durable shape one-to-one. Rows are
 * upserted on session state changes and at quit, and read back on launch to
 * rehydrate dormant sessions.
 */
export class SessionRepo {
  private upsertStmt: Database.Statement;
  private getStmt: Database.Statement;
  private getAllStmt: Database.Statement;
  private deleteStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.upsertStmt = db.prepare(`
      INSERT INTO sessions (
        id, last_state, task_id, worktree_path, label, project_path, command,
        sandboxed, is_runner, parent_id, created_at, buffer, cols, rows, updated_at
      ) VALUES (
        @id, @last_state, @task_id, @worktree_path, @label, @project_path, @command,
        @sandboxed, @is_runner, @parent_id, @created_at, @buffer, @cols, @rows, datetime('now')
      )
      ON CONFLICT(id) DO UPDATE SET
        last_state = excluded.last_state,
        task_id = excluded.task_id,
        worktree_path = excluded.worktree_path,
        label = excluded.label,
        project_path = excluded.project_path,
        command = excluded.command,
        sandboxed = excluded.sandboxed,
        is_runner = excluded.is_runner,
        parent_id = excluded.parent_id,
        buffer = excluded.buffer,
        cols = excluded.cols,
        rows = excluded.rows,
        updated_at = datetime('now')
    `);
    this.getStmt = db.prepare('SELECT * FROM sessions WHERE id = ?');
    this.getAllStmt = db.prepare('SELECT * FROM sessions ORDER BY created_at');
    this.deleteStmt = db.prepare('DELETE FROM sessions WHERE id = ?');
  }

  upsert(session: DurableSession): void {
    this.upsertStmt.run({
      id: session.id,
      last_state: session.lastState,
      task_id: session.taskId,
      worktree_path: session.worktreePath,
      label: session.label,
      project_path: session.projectPath,
      command: session.command,
      sandboxed: session.sandboxed ? 1 : 0,
      is_runner: session.isRunner ? 1 : 0,
      parent_id: session.parentId,
      created_at: session.createdAt,
      buffer: JSON.stringify(session.buffer),
      cols: session.cols,
      rows: session.rows,
    });
  }

  /** Upsert many sessions in a single transaction (used at quit). */
  upsertAll(sessions: DurableSession[]): void {
    this.db.transaction((rows: DurableSession[]) => {
      for (const row of rows) this.upsert(row);
    })(sessions);
  }

  get(id: string): DurableSession | null {
    const row = this.getStmt.get(id) as SessionRow | undefined;
    return row ? rowToDurable(row) : null;
  }

  getAll(): DurableSession[] {
    return (this.getAllStmt.all() as SessionRow[]).map(rowToDurable);
  }

  delete(id: string): void {
    this.deleteStmt.run(id);
  }
}

function rowToDurable(row: SessionRow): DurableSession {
  return {
    id: row.id,
    lastState: row.last_state as SessionState,
    taskId: row.task_id,
    worktreePath: row.worktree_path,
    label: row.label,
    projectPath: row.project_path,
    command: row.command,
    sandboxed: row.sandboxed === 1,
    isRunner: row.is_runner === 1,
    parentId: row.parent_id,
    createdAt: row.created_at,
    buffer: parseBuffer(row.buffer),
    cols: row.cols,
    rows: row.rows,
  };
}

function parseBuffer(raw: string): DurableBufferRef {
  try {
    const parsed = JSON.parse(raw) as DurableBufferRef;
    if (parsed && (parsed.kind === 'inline' || parsed.kind === 'file')) return parsed;
  } catch {
    // fall through to empty buffer
  }
  return { kind: 'inline', chunks: [] };
}
