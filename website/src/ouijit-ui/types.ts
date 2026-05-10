export type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done';

export type HookType = 'start' | 'continue' | 'run' | 'review' | 'cleanup' | 'editor';

export interface ChangedFile {
  path: string;
  status: 'M' | 'A' | 'D' | 'R' | '?';
  oldPath?: string;
  additions: number;
  deletions: number;
}

export interface GitFileStatus {
  branch: string;
  mainBranch: string;
  commitsAheadOfMain: number;
  uncommittedFiles: ChangedFile[];
  branchDiffFiles: ChangedFile[];
  untrackedFiles: string[];
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
  sandboxed?: boolean;
  order?: number;
  parentTaskNumber?: number;
}
