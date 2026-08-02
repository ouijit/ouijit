import type { GithubIssue } from '../../github/types';
import type { TaskWithWorkspace } from '../../types';
import { Icon } from '../terminal/Icon';
import { STATUS_LABELS } from '../kanban/taskMenu';
import { BoardCard, BoardCardTitle, BoardChipRow, BoardLabels, BoardMeta, BoardSubRow, NumberChip } from './BoardCard';
import { since } from './prFormat';

interface IssueCardProps {
  issue: GithubIssue;
  /** The task tracking this issue, when one has been made. */
  linkedTask?: TaskWithWorkspace;
  /** What clicking the linked task will do, so the row can say so first. */
  openTaskLabel?: (task: TaskWithWorkspace) => string;
  onCreateTask: (issueNumber: number) => void;
  onOpenTask: (task: TaskWithWorkspace) => void;
  onOpenExternal: (url: string) => void;
}

/**
 * An issue on the board.
 *
 * The last line is the same slot whether or not a task exists: linked, it is
 * the way into that work; unlinked, it is the way to start it. Keeping one
 * silhouette means a column of issues reads as a column of things in the same
 * state of progress rather than two unrelated row designs interleaved.
 */
export function IssueCard({
  issue,
  linkedTask,
  openTaskLabel,
  onCreateTask,
  onOpenTask,
  onOpenExternal,
}: IssueCardProps) {
  return (
    <BoardCard title={`Open issue #${issue.number} on GitHub`} onClick={() => onOpenExternal(issue.url)}>
      <BoardCardTitle
        icon="circle-dashed"
        iconClassName="text-vcs-added"
        title={issue.title}
        trailing={
          <span className="shrink-0 mt-px text-text-tertiary opacity-0 transition-opacity duration-150 group-hover:opacity-70">
            <Icon name="arrow-square-out" className="w-4 h-4" />
          </span>
        }
      />

      <BoardChipRow>
        <NumberChip number={issue.number} />
        <BoardLabels labels={issue.labels} />
      </BoardChipRow>

      <BoardMeta parts={[issue.author, since(issue.updatedAt), issue.isMine ? 'assigned to you' : null]} />

      {linkedTask ? (
        <BoardSubRow
          onClick={() => onOpenTask(linkedTask)}
          title={openTaskLabel ? `${openTaskLabel(linkedTask)} — ${linkedTask.name}` : linkedTask.name}
        >
          <span>T-{linkedTask.taskNumber}</span>
          <span className="opacity-50">{STATUS_LABELS[linkedTask.status] ?? linkedTask.status}</span>
        </BoardSubRow>
      ) : (
        <BoardSubRow muted onClick={() => onCreateTask(issue.number)} title="Create a task carrying this issue's body">
          Create task
        </BoardSubRow>
      )}
    </BoardCard>
  );
}
