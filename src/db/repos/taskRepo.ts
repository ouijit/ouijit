import type Database from 'better-sqlite3';

export type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done';

export interface TaskRow {
  id: number;
  project_path: string;
  task_number: number;
  name: string;
  status: TaskStatus;
  prompt: string | null;
  branch: string | null;
  worktree_path: string | null;
  merge_target: string | null;
  sandboxed: number;
  sort_order: number;
  created_at: string;
  closed_at: string | null;
}

export class TaskRepo {
  constructor(private db: Database.Database) {}

  getAllForProject(projectPath: string): TaskRow[] {
    return this.db
      .prepare('SELECT * FROM tasks WHERE project_path = ? ORDER BY sort_order, id')
      .all(projectPath) as TaskRow[];
  }

  getByBranch(projectPath: string, branch: string): TaskRow | undefined {
    return this.db.prepare('SELECT * FROM tasks WHERE project_path = ? AND branch = ?').get(projectPath, branch) as
      | TaskRow
      | undefined;
  }

  getByTaskNumber(projectPath: string, taskNumber: number): TaskRow | undefined {
    return this.db
      .prepare('SELECT * FROM tasks WHERE project_path = ? AND task_number = ?')
      .get(projectPath, taskNumber) as TaskRow | undefined;
  }

  getNextTaskNumber(projectPath: string): number {
    const counter = this.db
      .prepare('SELECT next_task_number FROM project_counters WHERE project_path = ?')
      .get(projectPath) as { next_task_number: number } | undefined;
    return counter?.next_task_number ?? 1;
  }

  create(
    projectPath: string,
    taskNumber: number,
    name: string,
    options?: {
      status?: TaskStatus;
      branch?: string;
      mergeTarget?: string;
      prompt?: string;
      sandboxed?: boolean;
      worktreePath?: string;
      createdAt?: string;
    },
  ): TaskRow {
    return this.db.transaction(() => {
      const status = options?.status ?? 'in_progress';

      // Assign order at the end of the target column
      const maxOrder = this.db
        .prepare('SELECT MAX(sort_order) as max_order FROM tasks WHERE project_path = ? AND status = ?')
        .get(projectPath, status) as { max_order: number | null };
      const sortOrder = (maxOrder?.max_order ?? -1) + 1;

      this.db
        .prepare(
          `
        INSERT INTO tasks (project_path, task_number, name, status, prompt, branch, worktree_path, merge_target, sandboxed, sort_order, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .run(
          projectPath,
          taskNumber,
          name,
          status,
          options?.prompt ?? null,
          options?.branch ?? null,
          options?.worktreePath ?? null,
          options?.mergeTarget ?? null,
          options?.sandboxed ? 1 : 0,
          sortOrder,
          options?.createdAt ?? new Date().toISOString(),
        );

      // Bump counter if this task number matches or exceeds it
      this.db
        .prepare('UPDATE project_counters SET next_task_number = MAX(next_task_number, ? + 1) WHERE project_path = ?')
        .run(taskNumber, projectPath);

      return this.getByTaskNumber(projectPath, taskNumber)!;
    })();
  }

  updateStatus(projectPath: string, taskNumber: number, status: TaskStatus): void {
    this.db.transaction(() => {
      const task = this.getByTaskNumber(projectPath, taskNumber);
      if (!task) return;

      const oldStatus = task.status;
      const closedAt = status === 'done' ? new Date().toISOString() : null;

      if (oldStatus !== status) {
        // Append to end of new column
        const maxOrder = this.db
          .prepare(
            'SELECT MAX(sort_order) as max_order FROM tasks WHERE project_path = ? AND status = ? AND task_number != ?',
          )
          .get(projectPath, status, taskNumber) as { max_order: number | null };
        const newOrder = (maxOrder?.max_order ?? -1) + 1;

        this.db
          .prepare('UPDATE tasks SET status = ?, closed_at = ?, sort_order = ? WHERE id = ?')
          .run(status, closedAt, newOrder, task.id);

        // Compact old column orders
        const oldColumnTasks = this.db
          .prepare(
            'SELECT id FROM tasks WHERE project_path = ? AND status = ? AND task_number != ? ORDER BY sort_order, id',
          )
          .all(projectPath, oldStatus, taskNumber) as { id: number }[];
        const updateOrder = this.db.prepare('UPDATE tasks SET sort_order = ? WHERE id = ?');
        for (let i = 0; i < oldColumnTasks.length; i++) {
          updateOrder.run(i, oldColumnTasks[i].id);
        }
      } else {
        // Same status — just update closedAt if needed
        this.db.prepare('UPDATE tasks SET status = ?, closed_at = ? WHERE id = ?').run(status, closedAt, task.id);
      }
    })();
  }

  updateBranch(projectPath: string, taskNumber: number, branch: string): void {
    this.db
      .prepare('UPDATE tasks SET branch = ? WHERE project_path = ? AND task_number = ?')
      .run(branch, projectPath, taskNumber);
  }

  updateWorktreePath(projectPath: string, taskNumber: number, worktreePath: string): void {
    this.db
      .prepare('UPDATE tasks SET worktree_path = ? WHERE project_path = ? AND task_number = ?')
      .run(worktreePath, projectPath, taskNumber);
  }

  updateMergeTarget(projectPath: string, taskNumber: number, mergeTarget: string): void {
    this.db
      .prepare('UPDATE tasks SET merge_target = ? WHERE project_path = ? AND task_number = ?')
      .run(mergeTarget, projectPath, taskNumber);
  }

  updateName(projectPath: string, taskNumber: number, name: string): void {
    this.db
      .prepare('UPDATE tasks SET name = ? WHERE project_path = ? AND task_number = ?')
      .run(name, projectPath, taskNumber);
  }

  updatePrompt(projectPath: string, taskNumber: number, prompt: string | null): void {
    this.db
      .prepare('UPDATE tasks SET prompt = ? WHERE project_path = ? AND task_number = ?')
      .run(prompt, projectPath, taskNumber);
  }

  updateSandboxed(projectPath: string, taskNumber: number, sandboxed: boolean): void {
    this.db
      .prepare('UPDATE tasks SET sandboxed = ? WHERE project_path = ? AND task_number = ?')
      .run(sandboxed ? 1 : 0, projectPath, taskNumber);
  }

  reorder(projectPath: string, taskNumber: number, newStatus: TaskStatus, targetIndex: number): void {
    this.db.transaction(() => {
      const task = this.getByTaskNumber(projectPath, taskNumber);
      if (!task) return;

      const oldStatus = task.status;
      const closedAt = newStatus === 'done' ? new Date().toISOString() : oldStatus === 'done' ? null : task.closed_at;

      // Get tasks in the target column (excluding the moved task), ordered
      const columnTasks = this.db
        .prepare(
          'SELECT id, task_number FROM tasks WHERE project_path = ? AND status = ? AND task_number != ? ORDER BY sort_order, id',
        )
        .all(projectPath, newStatus, taskNumber) as { id: number; task_number: number }[];

      // Insert at the target position
      const clampedIndex = Math.max(0, Math.min(targetIndex, columnTasks.length));
      columnTasks.splice(clampedIndex, 0, { id: task.id, task_number: taskNumber });

      // Prepare once, reuse in loop
      const updateOrder = this.db.prepare('UPDATE tasks SET sort_order = ? WHERE id = ?');

      // Reassign order values for the target column
      for (let i = 0; i < columnTasks.length; i++) {
        updateOrder.run(i, columnTasks[i].id);
      }

      // Update status and closedAt
      this.db.prepare('UPDATE tasks SET status = ?, closed_at = ? WHERE id = ?').run(newStatus, closedAt, task.id);

      // If moving across columns, also compact the old column
      if (oldStatus !== newStatus) {
        const oldColumnTasks = this.db
          .prepare(
            'SELECT id FROM tasks WHERE project_path = ? AND status = ? AND task_number != ? ORDER BY sort_order, id',
          )
          .all(projectPath, oldStatus, taskNumber) as { id: number }[];
        for (let i = 0; i < oldColumnTasks.length; i++) {
          updateOrder.run(i, oldColumnTasks[i].id);
        }
      }
    })();
  }

  delete(projectPath: string, taskNumber: number): void {
    this.db.prepare('DELETE FROM tasks WHERE project_path = ? AND task_number = ?').run(projectPath, taskNumber);
  }
}
