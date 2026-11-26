import type { TaskStatus } from './db/repos/taskRepo';

export interface TaskMetadata {
  taskNumber: number;
  branch?: string;
  name: string;
  status: TaskStatus;
  createdAt: string;
  closedAt?: string;
  worktreePath?: string;
  mergeTarget?: string;
  prompt?: string;
  order?: number;
  parentTaskNumber?: number;
  githubPrNumber?: number;
  githubIssueNumber?: number;
  linearIssueId?: string;
  /** `ENG-123`. Stored so a badge can render it without asking Linear. */
  linearIssueIdentifier?: string;
  /**
   * The branch name the task should start on — Linear's suggestion for the
   * issue it came from. Read at start time, so starting costs no round trip and
   * works offline. Provider-neutral: nothing about it is Linear's.
   */
  suggestedBranch?: string;
}

export interface TaskWithWorkspace {
  taskNumber: number;
  name: string;
  status: TaskStatus;
  branch?: string;
  worktreePath?: string;
  createdAt: string;
  closedAt?: string;
  mergeTarget?: string;
  prompt?: string;
  order?: number;
  parentTaskNumber?: number;
  /** Linked GitHub pull request, if any. Drives the kanban card badge. */
  githubPrNumber?: number;
  /** Linked GitHub issue, if the task was created from one. */
  githubIssueNumber?: number;
  /** Linked Linear issue, if the task was created from one. */
  linearIssueId?: string;
  /** `ENG-123`, stored so a badge renders without asking Linear. */
  linearIssueIdentifier?: string;
  /** The branch the task should start on, captured when it was created. */
  suggestedBranch?: string;
}
