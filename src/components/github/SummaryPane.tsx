import type { PullRequestDetail } from '../../github/types';
import type { TaskWithWorkspace } from '../../types';
import { Icon } from '../terminal/Icon';
import { Avatar } from './Avatar';
import { STATUS_LABELS } from '../kanban/taskMenu';
import { ChecksSection } from './ChecksSection';
import { Markdown } from './Markdown';
import { CommentComposer } from './CommentComposer';
import { Dot, Fact, Section } from './Sections';
import { TimelineEntries } from './TimelineEntries';
import { since } from './prFormat';

interface SummaryPaneProps {
  projectPath: string;
  detail: PullRequestDetail;
  linkedTask?: TaskWithWorkspace;
  openTaskLabel?: (task: TaskWithWorkspace) => string;
  onOpenTask: (task: TaskWithWorkspace) => void;
  onPromoteToTask: () => void;
}

/**
 * What this change is, before you read a line of it.
 *
 * The facts you check first — where it goes, who is on it, whether it builds —
 * are a label-and-value list rather than a row of chips, because they are read
 * by scanning down the labels for the one you want. Everything below is
 * collapsible and separated by a single rule under its heading; there is no
 * card, box or bevel anywhere on this pane.
 */
export function SummaryPane({
  projectPath,
  detail,
  linkedTask,
  openTaskLabel,
  onOpenTask,
  onPromoteToTask,
}: SummaryPaneProps) {
  const unresolved = detail.threads.filter((t) => !t.isResolved).length;
  // Events belong to the timeline; this section is what people have said.
  const comments = detail.timeline.filter((i) => i.kind !== 'event');

  return (
    <div className="w-full max-w-3xl mx-auto px-8 py-7 flex flex-col gap-7">
      <header className="flex flex-col gap-3">
        <h1 className="text-[28px] leading-tight font-medium text-text-primary text-balance">{detail.title}</h1>
        <div className="flex items-center gap-2 text-[15px] text-text-secondary">
          <Avatar login={detail.author} url={detail.authorAvatarUrl} size={22} />
          <span className="text-text-primary">{detail.author}</span>
          <Dot />
          <span>{since(detail.createdAt)}</span>
          <Dot />
          {/* The number is the thing people paste and quote, so it doubles as
              the way out to GitHub — the chrome's icon button says the same
              thing, but only to someone who already knows what it is. */}
          <button
            type="button"
            className="flex items-center gap-1 hover:text-accent transition-colors duration-100"
            title={`Open #${detail.number} on GitHub`}
            onClick={() => void window.api.openExternal(detail.url)}
          >
            #{detail.number}
            <Icon name="arrow-square-out" className="w-3.5 h-3.5 opacity-60" />
          </button>
          <Dot />
          <span>{readyLabel(detail)}</span>
        </div>
      </header>

      <dl className="flex flex-col gap-2.5">
        <Fact icon="git-branch" label="Branch">
          <span className="font-mono text-[13px] text-text-primary">{detail.headRefName}</span>
          <Icon name="caret-right" className="w-3 h-3 text-text-tertiary" />
          <span className="font-mono text-[13px] text-text-primary">{detail.baseRefName}</span>
          <span className="font-mono text-[13px] tabular-nums ml-1">
            <span className="text-diff-added">+{detail.additions}</span>{' '}
            <span className="text-diff-removed">-{detail.deletions}</span>
          </span>
        </Fact>

        <Fact icon="user-circle" label="Task">
          {linkedTask ? (
            <button
              type="button"
              className="flex items-center gap-1.5 text-[15px] text-text-primary hover:text-accent transition-colors duration-100"
              title={openTaskLabel ? `${openTaskLabel(linkedTask)} — ${linkedTask.name}` : linkedTask.name}
              onClick={() => onOpenTask(linkedTask)}
            >
              <span className="font-mono text-[13px]">T-{linkedTask.taskNumber}</span>
              <span className="text-text-tertiary">{STATUS_LABELS[linkedTask.status] ?? linkedTask.status}</span>
              <Icon name="arrow-right" className="w-3.5 h-3.5 opacity-60" />
            </button>
          ) : (
            <button
              type="button"
              className="text-[15px] text-text-tertiary hover:text-accent transition-colors duration-100"
              title="Create a task with a worktree at this pull request's head"
              onClick={onPromoteToTask}
            >
              Check out as task
            </button>
          )}
        </Fact>

        <Fact icon="chat-circle" label="Comments">
          <span className={comments.length + unresolved === 0 ? 'text-text-tertiary' : 'text-text-primary'}>
            {comments.length + unresolved === 0
              ? 'No comments'
              : `${comments.length + unresolved} ${comments.length + unresolved === 1 ? 'comment' : 'comments'}`}
            {unresolved > 0 && <span className="text-accent">, {unresolved} unresolved</span>}
          </span>
        </Fact>

        <Fact icon="clock" label="Checks">
          <span className={detail.checks.length === 0 ? 'text-text-tertiary' : 'text-text-primary'}>
            {checksLabel(detail)}
          </span>
        </Fact>
      </dl>

      <Section label="Description" defaultOpen>
        {detail.body.trim() ? (
          <Markdown body={detail.body} />
        ) : (
          <p className="text-[15px] text-text-tertiary">No description was written</p>
        )}
      </Section>

      <Section label="Checks" count={detail.checks.length}>
        <ChecksSection checks={detail.checks} />
      </Section>

      <Section label="Comments" count={comments.length} defaultOpen>
        <div className="flex flex-col gap-5">
          <TimelineEntries items={comments} empty="No comments yet" />
          <CommentComposer projectPath={projectPath} number={detail.number} subject="pr" />
        </div>
      </Section>
    </div>
  );
}

function readyLabel(detail: PullRequestDetail): string {
  if (detail.state === 'merged') return 'Merged';
  if (detail.state === 'closed') return 'Closed';
  if (detail.isDraft) return 'Draft';
  if (detail.reviewDecision === 'APPROVED') return 'Approved';
  if (detail.reviewDecision === 'CHANGES_REQUESTED') return 'Changes requested';
  return 'Ready for review';
}

function checksLabel(detail: PullRequestDetail): string {
  if (detail.checks.length === 0) return 'No CI checks';
  const failing = detail.checks.filter(
    (c) =>
      (!c.status || c.status === 'COMPLETED') &&
      ['FAILURE', 'ERROR', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(c.conclusion ?? ''),
  ).length;
  const running = detail.checks.filter((c) => c.status && c.status !== 'COMPLETED').length;
  if (failing > 0) return `${failing} of ${detail.checks.length} failing`;
  if (running > 0) return `${running} running`;
  return `${detail.checks.length} passing`;
}
