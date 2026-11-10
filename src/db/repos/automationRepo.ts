import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type {
  Automation,
  AutomationInput,
  AutomationRun,
  MissedRunPolicy,
  RunLocation,
  RunState,
  RunTrigger,
  AutomationKind,
} from '../../automations/types';
import { isSandboxProviderId } from '../../sandbox/types';

interface AutomationRow {
  id: string;
  project_path: string;
  name: string;
  kind: string;
  prompt: string | null;
  command: string | null;
  schedule: string | null;
  missed: string;
  location: string;
  sandbox: string;
  paused: number;
  created_at: string;
  next_run_at: string | null;
}

interface RunRow {
  id: string;
  automation_id: string;
  project_path: string;
  state: string;
  trigger: string;
  summary: string | null;
  reason: string | null;
  scheduled_for: string | null;
  started_at: string | null;
  ended_at: string | null;
  exit_code: number | null;
  worktree_path: string | null;
  branch: string | null;
  base_commit: string | null;
  merge_target: string | null;
  output: string | null;
  unread: number;
  task_number: number | null;
}

function toAutomation(row: AutomationRow): Automation {
  return {
    id: row.id,
    projectPath: row.project_path,
    name: row.name,
    kind: row.kind as AutomationKind,
    ...(row.prompt != null && { prompt: row.prompt }),
    ...(row.command != null && { command: row.command }),
    schedule: row.schedule,
    missed: row.missed as MissedRunPolicy,
    location: row.location as RunLocation,
    sandbox: isSandboxProviderId(row.sandbox) ? row.sandbox : 'nono',
    paused: row.paused === 1,
    createdAt: row.created_at,
    nextRunAt: row.next_run_at,
  };
}

function toRun(row: RunRow): AutomationRun {
  return {
    id: row.id,
    automationId: row.automation_id,
    projectPath: row.project_path,
    state: row.state as RunState,
    trigger: row.trigger as RunTrigger,
    ...(row.summary != null && { summary: row.summary }),
    ...(row.reason != null && { reason: row.reason }),
    ...(row.scheduled_for != null && { scheduledFor: row.scheduled_for }),
    ...(row.started_at != null && { startedAt: row.started_at }),
    ...(row.ended_at != null && { endedAt: row.ended_at }),
    ...(row.exit_code != null && { exitCode: row.exit_code }),
    ...(row.worktree_path != null && { worktreePath: row.worktree_path }),
    ...(row.branch != null && { branch: row.branch }),
    ...(row.base_commit != null && { baseCommit: row.base_commit }),
    ...(row.merge_target != null && { mergeTarget: row.merge_target }),
    ...(row.output != null && { output: row.output }),
    unread: row.unread === 1,
    ...(row.task_number != null && { taskNumber: row.task_number }),
  };
}

export type RunPatch = Partial<
  Pick<
    AutomationRun,
    | 'state'
    | 'summary'
    | 'reason'
    | 'startedAt'
    | 'endedAt'
    | 'exitCode'
    | 'worktreePath'
    | 'branch'
    | 'baseCommit'
    | 'mergeTarget'
    | 'output'
    | 'unread'
    | 'taskNumber'
  >
>;

const RUN_COLUMNS: Record<keyof RunPatch, string> = {
  state: 'state',
  summary: 'summary',
  reason: 'reason',
  startedAt: 'started_at',
  endedAt: 'ended_at',
  exitCode: 'exit_code',
  worktreePath: 'worktree_path',
  branch: 'branch',
  baseCommit: 'base_commit',
  mergeTarget: 'merge_target',
  output: 'output',
  unread: 'unread',
  taskNumber: 'task_number',
};

/** Runs kept per automation; older ones are dropped as new ones start. */
const KEPT_RUNS = 50;

export class AutomationRepo {
  constructor(private db: Database.Database) {}

  list(projectPath?: string): Automation[] {
    const rows = projectPath
      ? this.db.prepare('SELECT * FROM automations WHERE project_path = ? ORDER BY created_at').all(projectPath)
      : this.db.prepare('SELECT * FROM automations ORDER BY created_at').all();
    return (rows as AutomationRow[]).map(toAutomation);
  }

  get(id: string): Automation | undefined {
    const row = this.db.prepare('SELECT * FROM automations WHERE id = ?').get(id) as AutomationRow | undefined;
    return row && toAutomation(row);
  }

  findByName(projectPath: string, name: string): Automation | undefined {
    const row = this.db
      .prepare('SELECT * FROM automations WHERE project_path = ? AND name = ?')
      .get(projectPath, name) as AutomationRow | undefined;
    return row && toAutomation(row);
  }

  create(projectPath: string, input: AutomationInput, nextRunAt: string | null): Automation {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO automations
           (id, project_path, name, kind, prompt, command, schedule, missed, location, sandbox, created_at, next_run_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        projectPath,
        input.name,
        input.kind,
        input.prompt ?? null,
        input.command ?? null,
        input.schedule,
        input.missed,
        input.location,
        input.sandbox,
        new Date().toISOString(),
        nextRunAt,
      );
    return this.get(id)!;
  }

  update(id: string, input: AutomationInput, nextRunAt: string | null): Automation | undefined {
    this.db
      .prepare(
        `UPDATE automations SET name = ?, kind = ?, prompt = ?, command = ?, schedule = ?, missed = ?,
           location = ?, sandbox = ?, next_run_at = ? WHERE id = ?`,
      )
      .run(
        input.name,
        input.kind,
        input.prompt ?? null,
        input.command ?? null,
        input.schedule,
        input.missed,
        input.location,
        input.sandbox,
        nextRunAt,
        id,
      );
    return this.get(id);
  }

  setPaused(id: string, paused: boolean, nextRunAt: string | null): void {
    this.db
      .prepare('UPDATE automations SET paused = ?, next_run_at = ? WHERE id = ?')
      .run(paused ? 1 : 0, nextRunAt, id);
  }

  setNextRunAt(id: string, nextRunAt: string | null): void {
    this.db.prepare('UPDATE automations SET next_run_at = ? WHERE id = ?').run(nextRunAt, id);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM automations WHERE id = ?').run(id);
  }

  addRun(
    automation: Automation,
    run: { state: RunState; trigger: RunTrigger; scheduledFor?: string; reason?: string },
  ): AutomationRun {
    const id = randomUUID();
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO automation_runs (id, automation_id, project_path, state, trigger, scheduled_for, reason, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          automation.id,
          automation.projectPath,
          run.state,
          run.trigger,
          run.scheduledFor ?? null,
          run.reason ?? null,
          new Date().toISOString(),
        );
      this.db
        .prepare(
          `DELETE FROM automation_runs WHERE automation_id = ? AND id NOT IN (
             SELECT id FROM automation_runs WHERE automation_id = ? ORDER BY created_at DESC LIMIT ?)`,
        )
        .run(automation.id, automation.id, KEPT_RUNS);
    })();
    return this.getRun(id)!;
  }

  getRun(id: string): AutomationRun | undefined {
    const row = this.db.prepare('SELECT * FROM automation_runs WHERE id = ?').get(id) as RunRow | undefined;
    return row && toRun(row);
  }

  runs(projectPath?: string): AutomationRun[] {
    const rows = projectPath
      ? this.db
          .prepare('SELECT * FROM automation_runs WHERE project_path = ? ORDER BY created_at DESC')
          .all(projectPath)
      : this.db.prepare('SELECT * FROM automation_runs ORDER BY created_at DESC').all();
    return (rows as RunRow[]).map(toRun);
  }

  runsInState(states: RunState[]): AutomationRun[] {
    const rows = this.db
      .prepare(`SELECT * FROM automation_runs WHERE state IN (${states.map(() => '?').join(', ')}) ORDER BY created_at`)
      .all(...states) as RunRow[];
    return rows.map(toRun);
  }

  updateRun(id: string, patch: RunPatch): AutomationRun | undefined {
    const entries = Object.entries(patch) as [keyof RunPatch, unknown][];
    if (entries.length > 0) {
      const sets = entries.map(([key]) => `${RUN_COLUMNS[key]} = ?`).join(', ');
      const values = entries.map(([, v]) => (typeof v === 'boolean' ? (v ? 1 : 0) : (v ?? null)));
      this.db.prepare(`UPDATE automation_runs SET ${sets} WHERE id = ?`).run(...values, id);
    }
    return this.getRun(id);
  }
}
