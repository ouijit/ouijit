import type { GithubIssue } from '../../github/types';
import type { TaskWithWorkspace } from '../../types';
import { Icon } from '../terminal/Icon';
import { IssueCard } from './IssueCard';

interface IssueListProps {
  issues: GithubIssue[];
  /** Issue number → the task tracking it, when there is one. */
  linkedTasks: Record<number, TaskWithWorkspace>;
  openTaskLabel: (task: TaskWithWorkspace) => string;
  onCreateTask: (issueNumber: number) => void;
  onOpenTask: (task: TaskWithWorkspace) => void;
  onOpenExternal: (url: string) => void;
}

/**
 * Open issues, each with a one-click path to a task carrying the issue body as
 * its description. A PR later opened from that task closes the issue on merge,
 * because the closing keyword goes into the PR body automatically.
 */
export function IssueList({
  issues,
  linkedTasks,
  openTaskLabel,
  onCreateTask,
  onOpenTask,
  onOpenExternal,
}: IssueListProps) {
  if (issues.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-text-tertiary">
        <Icon name="circle-dashed" className="w-8 h-8 opacity-40" />
        <span className="font-mono text-[11px]">No open issues</span>
      </div>
    );
  }

  return (
    <>
      {issues.map((issue) => (
        <IssueCard
          key={issue.number}
          issue={issue}
          linkedTask={linkedTasks[issue.number]}
          openTaskLabel={openTaskLabel}
          onCreateTask={onCreateTask}
          onOpenTask={onOpenTask}
          onOpenExternal={onOpenExternal}
        />
      ))}
    </>
  );
}
