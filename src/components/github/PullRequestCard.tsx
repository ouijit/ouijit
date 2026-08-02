import type { PullRequestSummary } from '../../github/types';
import type { TaskWithWorkspace } from '../../types';
import { Icon } from '../terminal/Icon';
import { STATUS_LABELS } from '../kanban/taskMenu';
import {
  BoardCard,
  BoardCardTitle,
  BoardChip,
  BoardChipRow,
  BoardLabels,
  BoardMeta,
  BoardSubRow,
  NumberChip,
} from './BoardCard';
import { checksBadge, reviewDecisionLabel, since, stateBadge } from './prFormat';

interface PullRequestCardProps {
  pr: PullRequestSummary;
  /** Unsubmitted review comments the user has left on this pull request. */
  draftCount: number;
  /** The task this pull request is checked out as, when there is one. */
  linkedTask?: TaskWithWorkspace;
  /** What clicking the linked task will do, so the row can say so first. */
  openTaskLabel?: (task: TaskWithWorkspace) => string;
  onOpen: (number: number) => void;
  onOpenTask: (task: TaskWithWorkspace) => void;
}

/** Icon color tokens, pulled off the badge class the rest of the panel shares. */
const STATE_TONE: Record<string, string> = {
  Merged: 'text-vcs-renamed',
  Closed: 'text-vcs-deleted',
  Draft: 'text-ink/40',
  Open: 'text-vcs-added',
};

export function PullRequestCard({
  pr,
  draftCount,
  linkedTask,
  openTaskLabel,
  onOpen,
  onOpenTask,
}: PullRequestCardProps) {
  const badge = stateBadge(pr);
  const checks = checksBadge(pr.checksState);
  const decision = reviewDecisionLabel(pr.reviewDecision);

  return (
    <BoardCard onClick={() => onOpen(pr.number)}>
      <BoardCardTitle
        icon={badge.icon}
        iconClassName={STATE_TONE[badge.label] ?? 'text-text-tertiary'}
        title={pr.title}
        trailing={
          checks && (
            <span title={checks.label} className="shrink-0 mt-px">
              <Icon name={checks.icon} className={`w-4 h-4 ${checks.className}`} />
            </span>
          )
        }
      />

      <BoardChipRow>
        <NumberChip number={pr.number} />
        {draftCount > 0 && (
          <BoardChip tone="var(--color-accent)" title="Review comments you have written but not sent">
            {draftCount} unsent
          </BoardChip>
        )}
        {decision && <BoardChip tone={DECISION_TONE[decision.label]}>{decision.label}</BoardChip>}
        <BoardLabels labels={pr.labels} />
      </BoardChipRow>

      <BoardMeta
        parts={[
          pr.author,
          since(pr.updatedAt),
          <>
            <span className="text-diff-added">+{pr.additions}</span>{' '}
            <span className="text-diff-removed">-{pr.deletions}</span>
          </>,
        ]}
      />

      {linkedTask && (
        <BoardSubRow
          onClick={() => onOpenTask(linkedTask)}
          title={openTaskLabel ? `${openTaskLabel(linkedTask)} — ${linkedTask.name}` : linkedTask.name}
        >
          <span>T-{linkedTask.taskNumber}</span>
          <span className="opacity-50">{STATUS_LABELS[linkedTask.status] ?? linkedTask.status}</span>
        </BoardSubRow>
      )}
    </BoardCard>
  );
}

const DECISION_TONE: Record<string, string> = {
  Approved: 'var(--color-vcs-added)',
  'Changes requested': 'var(--color-vcs-deleted)',
  'Review required': 'var(--color-text-tertiary)',
};
