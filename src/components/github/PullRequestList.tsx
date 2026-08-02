import type { PullRequestSummary } from '../../github/types';
import type { TaskWithWorkspace } from '../../types';
import { Icon } from '../terminal/Icon';
import { BandHeader } from './DocumentSection';
import { PullRequestCard } from './PullRequestCard';

interface PullRequestListProps {
  needsReview: PullRequestSummary[];
  mine: PullRequestSummary[];
  others: PullRequestSummary[];
  /** PR number → unsubmitted draft count. */
  draftCounts: Record<number, number>;
  /** PR number → the task it is checked out as. */
  linkedTasks: Record<number, TaskWithWorkspace>;
  openTaskLabel: (task: TaskWithWorkspace) => string;
  onOpen: (number: number) => void;
  onOpenTask: (task: TaskWithWorkspace) => void;
}

/**
 * The inbox. Three sections rather than one flat list, because "a teammate is
 * waiting on you" and "you opened this" are different kinds of obligation and a
 * single updated-at ordering buries the first under the second.
 */
export function PullRequestList({
  needsReview,
  mine,
  others,
  draftCounts,
  linkedTasks,
  openTaskLabel,
  onOpen,
  onOpenTask,
}: PullRequestListProps) {
  if (needsReview.length === 0 && mine.length === 0 && others.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-text-tertiary">
        <Icon name="git-pull-request" className="w-8 h-8 opacity-40" />
        <span className="font-mono text-[11px]">No open pull requests</span>
      </div>
    );
  }

  const section = (title: string, prs: PullRequestSummary[]) =>
    prs.length > 0 && (
      <section>
        <BandHeader label={title} count={prs.length} />
        {prs.map((pr) => (
          <PullRequestCard
            key={pr.number}
            pr={pr}
            draftCount={draftCounts[pr.number] ?? 0}
            linkedTask={linkedTasks[pr.number]}
            openTaskLabel={openTaskLabel}
            onOpen={onOpen}
            onOpenTask={onOpenTask}
          />
        ))}
      </section>
    );

  return (
    <>
      {section('Needs your review', needsReview)}
      {section('Yours', mine)}
      {section('Everything else', others)}
    </>
  );
}
