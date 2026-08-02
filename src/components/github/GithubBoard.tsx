import type { ReactNode } from 'react';
import type { GithubIssue, PullRequestSummary } from '../../github/types';
import type { TaskWithWorkspace } from '../../types';
import { KanbanColumnView } from '../kanban/KanbanColumnView';
import { BoardColumnEmpty } from './BoardCard';
import { IssueCard } from './IssueCard';
import { PullRequestCard } from './PullRequestCard';

interface GithubBoardProps {
  needsReview: PullRequestSummary[];
  mine: PullRequestSummary[];
  others: PullRequestSummary[];
  issues: GithubIssue[];
  /** PR number → unsubmitted draft count. */
  draftCounts: Record<number, number>;
  /** PR number → the task it is checked out as. */
  prTasks: Record<number, TaskWithWorkspace>;
  /** Issue number → the task tracking it. */
  issueTasks: Record<number, TaskWithWorkspace>;
  issuesLoading: boolean;
  issuesError: string | null;
  openTaskLabel: (task: TaskWithWorkspace) => string;
  onOpenPullRequest: (number: number) => void;
  onOpenTask: (task: TaskWithWorkspace) => void;
  onCreateTaskFromIssue: (issueNumber: number) => void;
  onOpenExternal: (url: string) => void;
  onRetryIssues: () => void;
}

/**
 * The GitHub board.
 *
 * The inbox already sorted itself into buckets that mean different things —
 * someone is waiting on you, this is yours to land, this is everything else —
 * and issues are a fourth thing you can pick up. Those are columns, so this
 * renders the same column the kanban renders rather than a page of sections
 * with a tab strip over it. One board, four columns, cards that read like task
 * cards.
 */
export function GithubBoard({
  needsReview,
  mine,
  others,
  issues,
  draftCounts,
  prTasks,
  issueTasks,
  issuesLoading,
  issuesError,
  openTaskLabel,
  onOpenPullRequest,
  onOpenTask,
  onCreateTaskFromIssue,
  onOpenExternal,
  onRetryIssues,
}: GithubBoardProps) {
  const prColumn = (status: string, label: string, prs: PullRequestSummary[], emptyMessage: string): ReactNode => (
    <KanbanColumnView key={status} status={status} label={label} count={prs.length}>
      {prs.length === 0 ? (
        <BoardColumnEmpty message={emptyMessage} />
      ) : (
        prs.map((pr) => (
          <PullRequestCard
            key={pr.number}
            pr={pr}
            draftCount={draftCounts[pr.number] ?? 0}
            linkedTask={prTasks[pr.number]}
            openTaskLabel={openTaskLabel}
            onOpen={onOpenPullRequest}
            onOpenTask={onOpenTask}
          />
        ))
      )}
    </KanbanColumnView>
  );

  return (
    <div className="flex flex-1 min-h-0" style={{ overflowX: 'auto', overflowY: 'hidden' }}>
      {prColumn('needs-review', 'Needs your review', needsReview, 'Nobody is waiting on you')}
      {prColumn('mine', 'Yours', mine, 'You have nothing open')}
      {prColumn('others', 'Everything else', others, 'No other open pull requests')}

      <KanbanColumnView
        status="issues"
        label="Issues"
        count={issues.length}
        // The count is a lie until the first load lands, so say what is
        // happening in its place rather than showing a confident zero.
        caption={issuesLoading && issues.length === 0 ? 'loading' : undefined}
      >
        {issuesError ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 px-3 py-8 text-center">
            <span className="font-mono text-[11px] text-text-tertiary">{issuesError}</span>
            <button
              type="button"
              className="font-mono text-[11px] text-text-secondary hover:text-text-primary underline underline-offset-2"
              onClick={onRetryIssues}
            >
              Try again
            </button>
          </div>
        ) : issues.length === 0 ? (
          <BoardColumnEmpty message={issuesLoading ? '' : 'No open issues'} />
        ) : (
          issues.map((issue) => (
            <IssueCard
              key={issue.number}
              issue={issue}
              linkedTask={issueTasks[issue.number]}
              openTaskLabel={openTaskLabel}
              onCreateTask={onCreateTaskFromIssue}
              onOpenTask={onOpenTask}
              onOpenExternal={onOpenExternal}
            />
          ))
        )}
      </KanbanColumnView>
    </div>
  );
}
