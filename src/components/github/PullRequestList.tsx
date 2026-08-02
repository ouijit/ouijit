import type { PullRequestSummary } from '../../github/types';
import { Icon } from '../terminal/Icon';
import { checksBadge, reviewDecisionLabel, stateBadge, labelStyle, since } from './prFormat';

interface PullRequestListProps {
  needsReview: PullRequestSummary[];
  mine: PullRequestSummary[];
  others: PullRequestSummary[];
  /** PR number → unsubmitted draft count. */
  draftCounts: Record<number, number>;
  /** PR number → task number, when the PR is already checked out as a task. */
  linkedTasks: Record<number, number>;
  onOpen: (number: number) => void;
}

/**
 * The inbox. Three sections rather than one flat list, because "a teammate is
 * waiting on you" and "you opened this" are different kinds of obligation and
 * a single updated-at ordering buries the first under the second.
 */
export function PullRequestList({ needsReview, mine, others, draftCounts, linkedTasks, onOpen }: PullRequestListProps) {
  const empty = needsReview.length === 0 && mine.length === 0 && others.length === 0;

  if (empty) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-text-tertiary">
        <Icon name="git-pull-request" className="w-8 h-8 opacity-40" />
        <span className="text-sm">No open pull requests</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 pb-10">
      <Section title="Needs your review" prs={needsReview} {...{ draftCounts, linkedTasks, onOpen }} />
      <Section title="Yours" prs={mine} {...{ draftCounts, linkedTasks, onOpen }} />
      <Section title="Everything else" prs={others} {...{ draftCounts, linkedTasks, onOpen }} />
    </div>
  );
}

function Section({
  title,
  prs,
  draftCounts,
  linkedTasks,
  onOpen,
}: {
  title: string;
  prs: PullRequestSummary[];
  draftCounts: Record<number, number>;
  linkedTasks: Record<number, number>;
  onOpen: (number: number) => void;
}) {
  if (prs.length === 0) return null;
  return (
    <section>
      <h2 className="text-xs font-semibold text-text-tertiary mb-2 px-1">
        {title}
        <span className="ml-2 font-normal opacity-60">{prs.length}</span>
      </h2>
      <div className="glass-bevel relative border border-bezel rounded-[14px] overflow-hidden divide-y divide-ink/[0.06] bg-terminal-bg">
        {prs.map((pr) => (
          <PullRequestRow
            key={pr.number}
            pr={pr}
            draftCount={draftCounts[pr.number] ?? 0}
            linkedTask={linkedTasks[pr.number]}
            onOpen={onOpen}
          />
        ))}
      </div>
    </section>
  );
}

function PullRequestRow({
  pr,
  draftCount,
  linkedTask,
  onOpen,
}: {
  pr: PullRequestSummary;
  draftCount: number;
  linkedTask?: number;
  onOpen: (number: number) => void;
}) {
  const badge = stateBadge(pr);
  const checks = checksBadge(pr.checksState);
  const decision = reviewDecisionLabel(pr.reviewDecision);

  return (
    <button
      type="button"
      className="w-full text-left flex items-start gap-3 px-4 py-3 hover:bg-ink/[0.03] transition-colors duration-100"
      onClick={() => onOpen(pr.number)}
    >
      <Icon name={badge.icon} className={`w-4 h-4 mt-0.5 shrink-0 ${badge.className.split(' ').pop()}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm text-text-primary truncate">{pr.title}</span>
          {pr.labels.slice(0, 3).map((label) => (
            <span
              key={label.name}
              className="shrink-0 text-[10px] px-1.5 py-px rounded-full"
              style={labelStyle(label.color)}
            >
              {label.name}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-1 text-xs text-text-tertiary flex-wrap">
          <span className="font-mono">#{pr.number}</span>
          <span>{pr.author}</span>
          <span>{since(pr.updatedAt)}</span>
          <span className="font-mono">
            <span className="text-diff-added">+{pr.additions}</span>{' '}
            <span className="text-diff-removed">-{pr.deletions}</span>
          </span>
          {decision && <span className={decision.className}>{decision.label}</span>}
          {linkedTask != null && <span className="font-mono opacity-70">task #{linkedTask}</span>}
          {draftCount > 0 && (
            <span className="text-accent">
              {draftCount} unsent {draftCount === 1 ? 'comment' : 'comments'}
            </span>
          )}
        </div>
      </div>
      {checks && (
        <span title={checks.label} className="shrink-0 mt-0.5">
          <Icon name={checks.icon} className={`w-4 h-4 ${checks.className}`} />
        </span>
      )}
    </button>
  );
}
