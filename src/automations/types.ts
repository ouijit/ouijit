import type { SandboxProviderId } from '../sandbox/types';
import type { ActiveSession } from '../ptyManager';

export type AutomationKind = 'agent' | 'command';
export type MissedRunPolicy = 'run-once' | 'skip';
export type RunLocation = 'worktree' | 'project';

export interface Automation {
  id: string;
  projectPath: string;
  name: string;
  kind: AutomationKind;
  /** What the agent is told, for an agent automation. */
  prompt?: string;
  /** What runs, for a command automation. */
  command?: string;
  /** Cron in local time; null runs only when asked. */
  schedule: string | null;
  missed: MissedRunPolicy;
  location: RunLocation;
  sandbox: SandboxProviderId;
  paused: boolean;
  createdAt: string;
  nextRunAt: string | null;
}

export type AutomationInput = Pick<
  Automation,
  'name' | 'kind' | 'prompt' | 'command' | 'schedule' | 'missed' | 'location' | 'sandbox'
>;

export type RunState = 'queued' | 'running' | 'quiet' | 'needs-you' | 'failed' | 'skipped';
export type RunTrigger = 'schedule' | 'catch-up' | 'manual';

export interface AutomationRun {
  id: string;
  automationId: string;
  projectPath: string;
  state: RunState;
  trigger: RunTrigger;
  /** What the agent said needs the user, from `ouijit automation notify`. */
  summary?: string;
  /** Why a run was skipped or failed. */
  reason?: string;
  scheduledFor?: string;
  startedAt?: string;
  endedAt?: string;
  exitCode?: number;
  worktreePath?: string;
  branch?: string;
  baseCommit?: string;
  mergeTarget?: string;
  /** The terminal's last screen, kept once the run ends. */
  output?: string;
  unread: boolean;
  /** The task a run became. */
  taskNumber?: number;
  /** Its terminal while the run is going. */
  ptyId?: string;
}

/** What the page and the sidebar read: each automation with its recent runs. */
export interface AutomationsSnapshot {
  automations: Automation[];
  runs: AutomationRun[];
}

/**
 * What opening a run shows: its terminal while it is going, the agent picking
 * up its session in the run's worktree, the task it became, or its last screen.
 */
export type RunOpening =
  | { kind: 'live'; session: ActiveSession }
  | {
      kind: 'continue';
      worktreePath: string;
      branch?: string;
      /** The project's continue hook, or empty for a shell. */
      command: string;
      sandbox: SandboxProviderId;
      env: Record<string, string>;
    }
  | { kind: 'task'; taskNumber: number }
  | { kind: 'output' };
