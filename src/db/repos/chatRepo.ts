import type Database from 'better-sqlite3';

export interface ChatSessionRow {
  id: string;
  project_path: string;
  task_id: number | null;
  cwd: string;
  worktree_path: string | null;
  agent: string;
  agent_session_id: string | null;
  sandbox_provider: string | null;
  info: string;
  seq: number;
  created_at: string;
  updated_at: string;
}

export interface ChatNodeWrite {
  nodeId: string;
  position: number;
  body: string;
}

export class ChatRepo {
  constructor(private db: Database.Database) {}

  get(id: string): ChatSessionRow | undefined {
    return this.db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(id) as ChatSessionRow | undefined;
  }

  /** Newest first: the one a task's card resumes is the last one it ran. */
  listForTask(projectPath: string, taskId: number): ChatSessionRow[] {
    return this.db
      .prepare('SELECT * FROM chat_sessions WHERE project_path = ? AND task_id = ? ORDER BY updated_at DESC')
      .all(projectPath, taskId) as ChatSessionRow[];
  }

  /** The app-wide chat's conversations, newest first. */
  listHome(): ChatSessionRow[] {
    return this.db
      .prepare("SELECT * FROM chat_sessions WHERE id = 'chat' OR id LIKE 'home-%' ORDER BY updated_at DESC")
      .all() as ChatSessionRow[];
  }

  nodes(id: string): string[] {
    return (
      this.db.prepare('SELECT body FROM chat_nodes WHERE session_id = ? ORDER BY position').all(id) as {
        body: string;
      }[]
    ).map((row) => row.body);
  }

  /** One transaction per flush, so a crash leaves the transcript at a whole flush rather than half of one. */
  save(row: ChatSessionRow, upserts: ChatNodeWrite[], removed: string[]): void {
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO chat_sessions (id, project_path, task_id, cwd, worktree_path, agent, agent_session_id,
             sandbox_provider, info, seq, created_at, updated_at)
           VALUES (@id, @project_path, @task_id, @cwd, @worktree_path, @agent, @agent_session_id,
             @sandbox_provider, @info, @seq, @created_at, @updated_at)
           ON CONFLICT(id) DO UPDATE SET agent = excluded.agent, agent_session_id = excluded.agent_session_id,
             sandbox_provider = excluded.sandbox_provider, info = excluded.info, seq = excluded.seq,
             updated_at = excluded.updated_at`,
        )
        .run(row);
      const upsert = this.db.prepare(
        `INSERT INTO chat_nodes (session_id, node_id, position, body) VALUES (?, ?, ?, ?)
         ON CONFLICT(session_id, node_id) DO UPDATE SET position = excluded.position, body = excluded.body`,
      );
      for (const node of upserts) upsert.run(row.id, node.nodeId, node.position, node.body);
      const remove = this.db.prepare('DELETE FROM chat_nodes WHERE session_id = ? AND node_id = ?');
      for (const nodeId of removed) remove.run(row.id, nodeId);
    })();
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(id);
  }

  deleteForTask(projectPath: string, taskId: number): void {
    this.db.prepare('DELETE FROM chat_sessions WHERE project_path = ? AND task_id = ?').run(projectPath, taskId);
  }
}
