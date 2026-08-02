import { useCallback } from 'react';
import type { MergeMethod, PullRequestDetail } from '../../github/types';
import type { TaskWithWorkspace } from '../../types';
import { useGithubStore, type PullRequestTab } from '../../stores/githubStore';
import { useProjectStore } from '../../stores/projectStore';
import { Icon } from '../terminal/Icon';
import { STATUS_LABELS } from '../kanban/taskMenu';
import { BoardChip, BoardLabels, NumberChip } from './BoardCard';
import { PullRequestConversation } from './PullRequestConversation';
import { PullRequestFiles } from './PullRequestFiles';
import { PullRequestChecks } from './PullRequestChecks';
import { MergeBox } from './MergeBox';
import { RefreshButton } from './RefreshButton';
import { checksBadge, reviewDecisionLabel, since, stateBadge } from './prFormat';

interface PullRequestDetailViewProps {
  projectPath: string;
  detail: PullRequestDetail;
  /** Task already tracking this PR, when there is one. */
  linkedTask?: TaskWithWorkspace;
  /** What opening that task will do, so the chip can say so first. */
  openTaskLabel?: (task: TaskWithWorkspace) => string;
  onOpenTask: (task: TaskWithWorkspace) => void;
  onPromoteToTask: () => void;
}

const TABS: Array<{ id: PullRequestTab; label: string }> = [
  { id: 'conversation', label: 'Conversation' },
  { id: 'files', label: 'Files changed' },
  { id: 'checks', label: 'Checks' },
];

const STATE_TONE: Record<string, string> = {
  Merged: 'var(--color-vcs-renamed)',
  Closed: 'var(--color-vcs-deleted)',
  Draft: 'var(--color-text-tertiary)',
  Open: 'var(--color-vcs-added)',
};

const DECISION_TONE: Record<string, string> = {
  Approved: 'var(--color-vcs-added)',
  'Changes requested': 'var(--color-vcs-deleted)',
  'Review required': 'var(--color-text-tertiary)',
};

/**
 * One pull request, inside the same frame the board uses. The tab strip sits
 * where the column headers sat and is typed the same way, so moving from the
 * board into a pull request reads as the frame's contents changing rather than
 * as arriving somewhere else.
 */
export function PullRequestDetailView({
  projectPath,
  detail,
  linkedTask,
  openTaskLabel,
  onOpenTask,
  onPromoteToTask,
}: PullRequestDetailViewProps) {
  const tab = useGithubStore((s) => s.tab);
  const detailLoading = useGithubStore((s) => s.detailLoading);
  const badge = stateBadge(detail);
  const checks = checksBadge(detail.checksState);
  const decision = reviewDecisionLabel(detail.reviewDecision);

  const merge = useCallback(
    async (method: MergeMethod, deleteBranch: boolean) => {
      const result = await window.api.github.mergePr(projectPath, detail.number, method, deleteBranch);
      if (!result.success) {
        useProjectStore.getState().addToast(result.error ?? 'Merge failed', 'error');
        return;
      }
      useProjectStore.getState().addToast(`Merged #${detail.number}`, 'success');
      await useGithubStore.getState().reloadDetail(projectPath);
      await useGithubStore.getState().loadInbox(projectPath);
    },
    [projectPath, detail.number],
  );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <header className="shrink-0 px-3 pt-2.5">
        <div className="flex items-start gap-2">
          <button
            type="button"
            className="w-6 h-6 shrink-0 rounded text-text-tertiary flex items-center justify-center hover:bg-ink/[0.08] hover:text-text-primary transition-colors duration-150 [&>svg]:w-4 [&>svg]:h-4"
            title="Back to the board"
            onClick={() => useGithubStore.getState().closeDetail()}
          >
            <Icon name="caret-left" />
          </button>
          <h1 className="flex-1 font-mono text-sm font-medium text-text-primary min-w-0 break-words pt-0.5">
            {detail.title}
          </h1>
          <div className="flex items-center gap-1 shrink-0">
            {linkedTask ? (
              <button
                type="button"
                className="flex items-center gap-1.5 font-mono text-[11px] leading-none px-2 py-1.5 rounded-full text-text-secondary hover:text-text-primary transition-colors duration-100"
                style={{ background: 'color-mix(in srgb, var(--color-ink) 4%, transparent)' }}
                title={openTaskLabel ? `${openTaskLabel(linkedTask)} — ${linkedTask.name}` : linkedTask.name}
                onClick={() => onOpenTask(linkedTask)}
              >
                <span>T-{linkedTask.taskNumber}</span>
                <span className="opacity-50">{STATUS_LABELS[linkedTask.status] ?? linkedTask.status}</span>
                <Icon name="arrow-right" className="w-3 h-3 opacity-60" />
              </button>
            ) : (
              <button
                type="button"
                className="font-mono text-[11px] leading-none px-2.5 py-1.5 rounded-full text-text-secondary hover:text-text-primary transition-colors duration-100"
                style={{ background: 'color-mix(in srgb, var(--color-ink) 6%, transparent)' }}
                title="Create a task with a worktree at this pull request's head"
                onClick={onPromoteToTask}
              >
                Check out as task
              </button>
            )}
            <RefreshButton
              busy={detailLoading}
              onClick={() => void useGithubStore.getState().reloadDetail(projectPath)}
            />
            <button
              type="button"
              className="w-7 h-7 rounded-md text-text-secondary flex items-center justify-center hover:bg-ink/10 hover:text-text-primary transition-all duration-150 [&>svg]:w-4 [&>svg]:h-4"
              title="Open on GitHub"
              onClick={() => void window.api.openExternal(detail.url)}
            >
              <Icon name="arrow-square-out" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1 flex-wrap mt-1.5 pl-8">
          <NumberChip number={detail.number} />
          <BoardChip tone={STATE_TONE[badge.label]}>{badge.label}</BoardChip>
          {decision && <BoardChip tone={DECISION_TONE[decision.label]}>{decision.label}</BoardChip>}
          {checks && (
            <BoardChip tone={CHECK_TONE[checks.icon]} title={checks.label}>
              {checks.label}
            </BoardChip>
          )}
          <BoardLabels labels={detail.labels} max={4} />
        </div>

        <div className="flex items-center gap-1.5 flex-wrap mt-1.5 pl-8 font-mono text-[10px] leading-tight text-text-secondary">
          <span>{detail.author}</span>
          <span className="opacity-30">·</span>
          <span>
            {detail.headRefName} <span className="opacity-40">into</span> {detail.baseRefName}
          </span>
          <span className="opacity-30">·</span>
          <span>{since(detail.updatedAt)}</span>
        </div>
      </header>

      {/* The tab strip takes the column header's job and its type, and hands
          off to the body across the same hairline a column body sits under. */}
      <nav
        className="shrink-0 flex items-center gap-1 px-3 mt-2"
        style={{ borderBottom: '1px solid color-mix(in srgb, var(--color-ink) 6%, transparent)' }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`px-2 py-2 text-[13px] font-medium tracking-wide transition-colors duration-100 -mb-px border-b ${
              tab === t.id
                ? 'text-text-primary border-accent'
                : 'text-text-secondary opacity-60 hover:opacity-100 border-transparent'
            }`}
            onClick={() => useGithubStore.getState().setTab(t.id)}
          >
            {t.label}
            {t.id === 'files' && detail.changedFiles > 0 && (
              <span className="ml-1.5 font-normal opacity-50">{detail.changedFiles}</span>
            )}
            {t.id === 'checks' && detail.checks.length > 0 && (
              <span className="ml-1.5 font-normal opacity-50">{detail.checks.length}</span>
            )}
          </button>
        ))}
      </nav>

      {tab === 'conversation' && (
        <div className="flex flex-col flex-1 min-h-0">
          <PullRequestConversation projectPath={projectPath} detail={detail} />
          <div
            className="shrink-0 px-3 py-2.5"
            style={{ borderTop: '1px solid color-mix(in srgb, var(--color-ink) 6%, transparent)' }}
          >
            <MergeBox detail={detail} onMerge={merge} />
          </div>
        </div>
      )}
      {tab === 'files' && <PullRequestFiles projectPath={projectPath} detail={detail} />}
      {tab === 'checks' && <PullRequestChecks checks={detail.checks} />}
    </div>
  );
}

const CHECK_TONE: Record<string, string> = {
  'check-circle': 'var(--color-vcs-added)',
  'x-circle': 'var(--color-vcs-deleted)',
  clock: 'var(--color-vcs-modified)',
};
