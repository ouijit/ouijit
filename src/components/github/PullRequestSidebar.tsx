import { useMemo, useState } from 'react';
import type { GithubIssue, PullRequestSummary } from '../../github/types';
import type { TaskWithWorkspace } from '../../types';
import { Icon } from '../terminal/Icon';
import { Avatar } from './Avatar';
import { Tab, TabBar } from './Tabs';
import { since, stateBadge } from './prFormat';

interface PullRequestSidebarProps {
  needsReview: PullRequestSummary[];
  mine: PullRequestSummary[];
  others: PullRequestSummary[];
  issues: GithubIssue[];
  draftCounts: Record<number, number>;
  prTasks: Record<number, TaskWithWorkspace>;
  issueTasks: Record<number, TaskWithWorkspace>;
  /** Which list is showing, and which row in it is open. */
  showing: 'pulls' | 'issues';
  activeNumber: number | null;
  activeIssue: number | null;
  onShow: (showing: 'pulls' | 'issues') => void;
  onOpenPullRequest: (number: number) => void;
  onOpenIssue: (issue: GithubIssue) => void;
  onCreateTaskFromIssue: (issueNumber: number) => void;
  /** Go to the work: focus its shell, or open/create its worktree. */
  onOpenTask: (task: TaskWithWorkspace) => void;
  loading: boolean;
}

/**
 * The list, kept on screen rather than replaced by whatever you opened.
 *
 * Review is a queue: you work down it, and losing sight of what is left every
 * time you open something is what made the old full-width list wrong. Search
 * filters what is already loaded — no round trip, so it narrows as you type.
 */
export function PullRequestSidebar({
  needsReview,
  mine,
  others,
  issues,
  draftCounts,
  prTasks,
  issueTasks,
  showing,
  activeNumber,
  activeIssue,
  onShow,
  onOpenPullRequest,
  onOpenIssue,
  onCreateTaskFromIssue,
  onOpenTask,
  loading,
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
      issues: issues.filter((i) => match([i.title, i.author, `#${i.number}`])),
    };
  }, [query, needsReview, mine, others, issues]);

  const pullCount = needsReview.length + mine.length + others.length;

  const empty =
    showing === 'issues'
      ? groups.issues.length === 0
      : groups.needsReview.length === 0 && groups.mine.length === 0 && groups.others.length === 0;

  return (
    <div className="w-[320px] shrink-0 flex flex-col overflow-hidden border-r border-ink/[0.06]">
      <div className="shrink-0 flex flex-col">
        <TabBar className="h-12 px-3 items-center border-b border-ink/[0.06]">
          <Tab active={showing === 'pulls'} count={pullCount} onClick={() => onShow('pulls')}>
            Pull requests
          </Tab>
          <Tab active={showing === 'issues'} count={issues.length} onClick={() => onShow('issues')}>
            Issues
          </Tab>
        </TabBar>
        <div className="px-3 py-2">
          <label className="flex items-center gap-2 h-9 px-3 rounded-full bg-ink/[0.05] focus-within:bg-ink/[0.08] transition-colors duration-150">
            <Icon name="magnifying-glass" className="w-4 h-4 shrink-0 text-text-tertiary" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
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
        {empty ? (
          <p className="px-4 py-8 text-center text-sm text-text-tertiary">
            {loading ? '' : query ? 'Nothing matches that' : showing === 'issues' ? 'No open issues' : 'Nothing open'}
          </p>
        ) : showing === 'issues' ? (
          <Group label="Open">
            {groups.issues.map((issue) => (
              <IssueRow
                key={issue.number}
                issue={issue}
                task={issueTasks[issue.number]}
                active={activeIssue === issue.number}
                onOpen={() => onOpenIssue(issue)}
                onOpenTask={onOpenTask}
                onCreateTask={() => onCreateTaskFromIssue(issue.number)}
              />
            ))}
          </Group>
        ) : (
          <>
            <Group label="Needs your review">
              {groups.needsReview.map((pr) => (
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
            <Group label="Authored">
              {groups.mine.map((pr) => (
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
            <Group label="Everything else">
              {groups.others.map((pr) => (
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
          </>
        )}
      </div>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode[] }) {
  if (children.length === 0) return null;
  return (
    <section className="pt-3">
      <h2 className="px-4 pb-1 text-[13px] text-text-tertiary">{label}</h2>
      {children}
    </section>
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
    <div
      className={`w-full px-4 py-2 flex flex-col gap-0.5 transition-colors duration-100 ${
        active ? 'bg-ink/[0.07]' : 'hover:bg-ink/[0.04]'
      }`}
    >
      <button type="button" className="flex items-baseline gap-2 text-left" onClick={onOpen}>
        <span className="flex-1 min-w-0 truncate text-[15px] text-text-primary">{pr.title}</span>
        <span className="shrink-0 text-[13px] text-text-tertiary">{since(pr.updatedAt)}</span>
      </button>
      <span className="flex items-center gap-2 min-w-0 text-[13px] text-text-tertiary">
        <Icon name={badge.icon} className={`w-3.5 h-3.5 shrink-0 ${STATE_TONE[badge.label] ?? ''}`} />
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

/**
 * The task tracking this row, and the way into it. A bare number announced
 * that work existed and gave you no way to reach it, which left the row with
 * nothing to offer once a task had been made.
 */
function TaskLink({ task, onOpen }: { task: TaskWithWorkspace; onOpen: (task: TaskWithWorkspace) => void }) {
  return (
    <button
      type="button"
      className="shrink-0 font-mono text-[12px] text-text-tertiary hover:text-accent transition-colors duration-100"
      title={task.name}
      onClick={() => onOpen(task)}
    >
      T-{task.taskNumber}
    </button>
  );
}

function IssueRow({
  issue,
  task,
  active,
  onOpen,
  onOpenTask,
  onCreateTask,
}: {
  issue: GithubIssue;
  task?: TaskWithWorkspace;
  active: boolean;
  onOpen: () => void;
  onOpenTask: (task: TaskWithWorkspace) => void;
  onCreateTask: () => void;
}) {
  return (
    <div
      className={`group w-full px-4 py-2 flex flex-col gap-0.5 transition-colors duration-100 ${
        active ? 'bg-ink/[0.07]' : 'hover:bg-ink/[0.04]'
      }`}
    >
      <button type="button" className="flex items-baseline gap-2 text-left" onClick={onOpen}>
        <span className="flex-1 min-w-0 truncate text-[15px] text-text-primary">{issue.title}</span>
        <span className="shrink-0 text-[13px] text-text-tertiary">{since(issue.updatedAt)}</span>
      </button>
      <span className="flex items-center gap-2 min-w-0 text-[13px] text-text-tertiary">
        <Icon name="circle-dashed" className="w-3.5 h-3.5 shrink-0 text-vcs-added" />
        <Avatar login={issue.author} url={issue.authorAvatarUrl} size={16} />
        <span className="shrink-0">{issue.author}</span>
        <span className="flex-1 min-w-0 truncate font-mono text-[12px]">#{issue.number}</span>
        {task ? (
          <TaskLink task={task} onOpen={onOpenTask} />
        ) : (
          <button
            type="button"
            className="shrink-0 text-[13px] text-text-tertiary opacity-0 group-hover:opacity-100 hover:text-accent transition-all duration-100"
            onClick={onCreateTask}
          >
            Create task
          </button>
        )}
      </span>
    </div>
  );
}

const STATE_TONE: Record<string, string> = {
  Merged: 'text-vcs-renamed',
  Closed: 'text-vcs-deleted',
  Draft: 'text-text-tertiary',
  Open: 'text-vcs-added',
};
