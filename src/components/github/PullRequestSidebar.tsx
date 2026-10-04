import { useMemo, useState, type ReactNode } from 'react';
import type { PullRequestSummary } from '../../github/types';
import type { TaskWithWorkspace } from '../../types';
import { Icon } from '../terminal/Icon';
import { Avatar } from '../issues/Avatar';
import { Tab, TabBar } from '../issues/Tabs';
import { since } from '../issues/since';
import { Group, rowClass, rowTitleClass, TaskLink } from '../issues/rows';
import { stateBadge } from './prFormat';

interface PullRequestSidebarProps {
  needsReview: PullRequestSummary[];
  mine: PullRequestSummary[];
  others: PullRequestSummary[];
  draftCounts: Record<number, number>;
  prTasks: Record<number, TaskWithWorkspace>;
  showing: 'pulls' | 'issues';
  /** Count beside the Issues tab, across every source feeding the list. */
  issueCount: number;
  activeNumber: number | null;
  onShow: (showing: 'pulls' | 'issues') => void;
  onOpenPullRequest: (number: number) => void;
  /** Focus the task's shell, or open/create its worktree. */
  onOpenTask: (task: TaskWithWorkspace) => void;
  /** The Issues list, rendered under this list's own search box. */
  issues: (query: string) => ReactNode;
  /** Why the pull request half is empty, when it is not simply empty. */
  unavailable?: string;
  loading: boolean;
  width: number;
}

/** Reading order: review requests, then your own, then the rest. */
const PULL_GROUPS = [
  ['Needs your review', 'needsReview'],
  ['Authored', 'mine'],
  ['Everything else', 'others'],
] as const;

/**
 * The list, kept on screen beside whatever is open. Search filters what is
 * already loaded, with no round trip.
 */
export function PullRequestSidebar({
  needsReview,
  mine,
  others,
  draftCounts,
  prTasks,
  showing,
  issueCount,
  activeNumber,
  onShow,
  onOpenPullRequest,
  onOpenTask,
  issues,
  unavailable,
  loading,
  width,
}: PullRequestSidebarProps) {
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const match = (text: string[]) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return text.some((t) => t.toLowerCase().includes(q));
    };
    const prs = (list: PullRequestSummary[]) =>
      list.filter((pr) => match([pr.title, pr.author, pr.headRefName, `#${pr.number}`]));
    return {
      needsReview: prs(needsReview),
      mine: prs(mine),
      others: prs(others),
    };
  }, [query, needsReview, mine, others]);

  const pullCount = needsReview.length + mine.length + others.length;
  const noPulls = groups.needsReview.length === 0 && groups.mine.length === 0 && groups.others.length === 0;

  return (
    // No right border: the resize handle beside this is the boundary.
    <div className="shrink-0 flex flex-col overflow-hidden" style={{ width }}>
      <div className="shrink-0 flex flex-col">
        <TabBar className="pane-ledge h-12 px-3 items-center">
          <Tab active={showing === 'pulls'} count={pullCount} onClick={() => onShow('pulls')}>
            Pull requests
          </Tab>
          <Tab active={showing === 'issues'} count={issueCount} onClick={() => onShow('issues')}>
            Issues
          </Tab>
        </TabBar>
        <div className="px-3 py-2">
          <label className="flex items-center gap-2 h-9 px-3 rounded-full bg-ink/[0.05] focus-within:bg-ink/[0.08] transition-colors duration-150">
            <Icon name="magnifying-glass" className="w-4 h-4 shrink-0 text-text-tertiary" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // Escape clears the query first, and only then falls through
                // to leaving the panel.
                if (e.key === 'Escape' && query) {
                  e.preventDefault();
                  setQuery('');
                }
              }}
              placeholder={showing === 'issues' ? 'Search issues' : 'Search pull requests'}
              className="flex-1 min-w-0 bg-transparent border-none outline-none text-sm text-text-primary placeholder:text-text-tertiary"
            />
            {query && (
              <button
                type="button"
                className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-text-tertiary hover:text-text-primary"
                title="Clear"
                onClick={() => setQuery('')}
              >
                <Icon name="x" className="w-3 h-3" />
              </button>
            )}
          </label>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pb-4">
        {showing === 'issues' ? (
          issues(query)
        ) : unavailable ? (
          // The panel opens for any source, so this tab can be the empty one.
          <p className="px-4 py-8 text-sm text-text-tertiary text-center text-balance">{unavailable}</p>
        ) : noPulls ? (
          <p className="px-4 py-8 text-center text-sm text-text-tertiary">
            {loading ? '' : query ? 'Nothing matches that' : 'Nothing open'}
          </p>
        ) : (
          PULL_GROUPS.map(([label, key]) => (
            <Group key={label} label={label}>
              {groups[key].map((pr) => (
                <PullRequestRow
                  key={pr.number}
                  pr={pr}
                  drafts={draftCounts[pr.number] ?? 0}
                  task={prTasks[pr.number]}
                  active={activeNumber === pr.number}
                  onOpen={() => onOpenPullRequest(pr.number)}
                  onOpenTask={onOpenTask}
                />
              ))}
            </Group>
          ))
        )}
      </div>
    </div>
  );
}

function PullRequestRow({
  pr,
  drafts,
  task,
  active,
  onOpen,
  onOpenTask,
}: {
  pr: PullRequestSummary;
  drafts: number;
  task?: TaskWithWorkspace;
  active: boolean;
  onOpen: () => void;
  onOpenTask: (task: TaskWithWorkspace) => void;
}) {
  const badge = stateBadge(pr);
  return (
    <div className={rowClass(active)}>
      <button type="button" className={rowTitleClass} onClick={onOpen}>
        <span className="flex-1 min-w-0 truncate text-[15px] text-text-primary">{pr.title}</span>
        <span className="shrink-0 text-[13px] text-text-tertiary">{since(pr.updatedAt)}</span>
      </button>
      <span className="flex items-center gap-2 min-w-0 text-[13px] text-text-tertiary">
        <Icon name={badge.icon} className={`w-3.5 h-3.5 shrink-0 ${badge.tone}`} />
        <Avatar login={pr.author} url={pr.authorAvatarUrl} size={16} />
        <span className="shrink-0">{pr.author}</span>
        <span className="flex-1 min-w-0 truncate font-mono text-[12px]">{pr.headRefName}</span>
        {drafts > 0 && <span className="shrink-0 text-accent">{drafts} unsent</span>}
        {task && <TaskLink task={task} onOpen={onOpenTask} />}
        <span className="shrink-0 font-mono text-[12px] tabular-nums">
          <span className="text-diff-added">+{pr.additions}</span>{' '}
          <span className="text-diff-removed">-{pr.deletions}</span>
        </span>
      </span>
    </div>
  );
}
