import { useCallback } from 'react';
import type { MergeMethod, PullRequestDetail } from '../../github/types';
import { useGithubStore, type PullRequestTab } from '../../stores/githubStore';
import { useProjectStore } from '../../stores/projectStore';
import { Icon } from '../terminal/Icon';
import { PullRequestConversation } from './PullRequestConversation';
import { PullRequestFiles } from './PullRequestFiles';
import { PullRequestChecks } from './PullRequestChecks';
import { MergeBox } from './MergeBox';
import { RefreshButton } from './RefreshButton';
import { checksBadge, labelStyle, reviewDecisionLabel, since, stateBadge } from './prFormat';

interface PullRequestDetailViewProps {
  projectPath: string;
  detail: PullRequestDetail;
  /** Task already tracking this PR, when there is one. */
  linkedTask?: number;
  onPromoteToTask: () => void;
}

const TABS: Array<{ id: PullRequestTab; label: string }> = [
  { id: 'conversation', label: 'Conversation' },
  { id: 'files', label: 'Files changed' },
  { id: 'checks', label: 'Checks' },
];

export function PullRequestDetailView({
  projectPath,
  detail,
  linkedTask,
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
      <header className="shrink-0 px-6 pt-3 pb-2 border-b border-bezel">
        <div className="flex items-start gap-3">
          <button
            type="button"
            className="mt-0.5 w-7 h-7 shrink-0 rounded-md text-text-secondary flex items-center justify-center hover:bg-ink/10 hover:text-text-primary transition-all duration-150"
            title="Back to pull requests"
            onClick={() => useGithubStore.getState().closeDetail()}
          >
            <Icon name="caret-left" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-base font-semibold text-text-primary">{detail.title}</h1>
              <span className="font-mono text-sm text-text-tertiary">#{detail.number}</span>
              <span className={`text-[11px] px-1.5 py-px rounded-full font-medium ${badge.className}`}>
                {badge.label}
              </span>
              {detail.labels.map((label) => (
                <span
                  key={label.name}
                  className="text-[10px] px-1.5 py-px rounded-full"
                  style={labelStyle(label.color)}
                >
                  {label.name}
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-1 text-xs text-text-tertiary flex-wrap">
              <span>{detail.author}</span>
              <span>
                wants to merge <span className="font-mono">{detail.headRefName}</span> into{' '}
                <span className="font-mono">{detail.baseRefName}</span>
              </span>
              <span>{since(detail.updatedAt)}</span>
              {decision && <span className={decision.className}>{decision.label}</span>}
              {checks && <Icon name={checks.icon} className={`w-3.5 h-3.5 ${checks.className}`} />}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {linkedTask != null ? (
              <span className="text-xs font-mono text-text-tertiary px-2">task #{linkedTask}</span>
            ) : (
              <button
                type="button"
                className="text-xs px-2.5 py-1.5 rounded-md bg-ink/[0.08] text-text-primary hover:bg-ink/[0.12]"
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
              className="w-7 h-7 rounded-md text-text-secondary flex items-center justify-center hover:bg-ink/10 hover:text-text-primary transition-all duration-150"
              title="Open on GitHub"
              onClick={() => void window.api.openExternal(detail.url)}
            >
              <Icon name="arrow-square-out" />
            </button>
          </div>
        </div>

        <nav className="flex items-center gap-1 mt-3 -mb-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`px-3 py-1.5 text-xs rounded-t-md border-b-2 transition-colors duration-100 ${
                tab === t.id
                  ? 'border-accent text-text-primary'
                  : 'border-transparent text-text-tertiary hover:text-text-secondary'
              }`}
              onClick={() => useGithubStore.getState().setTab(t.id)}
            >
              {t.label}
              {t.id === 'files' && detail.changedFiles > 0 && (
                <span className="ml-1.5 opacity-60">{detail.changedFiles}</span>
              )}
            </button>
          ))}
        </nav>
      </header>

      {tab === 'conversation' && (
        <div className="flex flex-col flex-1 min-h-0">
          <PullRequestConversation projectPath={projectPath} detail={detail} />
          <div className="shrink-0 px-6 py-3 border-t border-bezel">
            <MergeBox detail={detail} onMerge={merge} />
          </div>
        </div>
      )}
      {tab === 'files' && <PullRequestFiles projectPath={projectPath} detail={detail} />}
      {tab === 'checks' && <PullRequestChecks checks={detail.checks} />}
    </div>
  );
}
