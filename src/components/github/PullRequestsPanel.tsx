import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { useGithubStore } from '../../stores/githubStore';
import { usePanelStore, SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH } from '../../stores/panelStore';
import { useProjectStore } from '../../stores/projectStore';
import { ResizeHandle } from '../common/ResizeHandle';
import { SidebarToggle } from '../common/SidebarToggle';
import { useAppStore } from '../../stores/appStore';
import { activateTask, taskOpenAction, TASK_OPEN_LABEL } from '../navigation';
import { Icon } from '../terminal/Icon';
import { PullRequestSidebar } from './PullRequestSidebar';
import { PullRequestDetailView } from './PullRequestDetailView';
import { GithubIssueView } from './GithubIssueView';
import { LinearIssueView } from '../linear/LinearIssueView';
import { ConnectRow } from '../linear/ConnectRow';
import { IssueList } from '../issues/IssueList';
import { issueGroups } from '../issues/groups';
import { useLinearStore } from '../../stores/linearStore';
import type { IssueRow } from '../../issues/types';
import type { TaskWithWorkspace } from '../../types';
import { PanelFrame } from '../ui/PanelFrame';
import { useEscape } from '../../hooks/useEscape';
import { RefreshButton } from '../issues/RefreshButton';
import { Loading } from '../issues/Loading';

interface PullRequestsPanelProps {
  projectPath: string;
}

/**
 * The tracker surface: the list on the left, whatever is open on the right.
 *
 * A host rather than GitHub's own panel — the Issues list is fed by every
 * source that has something to put in it, and what is open lives in one slot
 * on `panelStore` so two of them cannot both think they are showing something.
 *
 * Reviewing leaves nothing behind but the fetched refs — the diff is read out
 * of the object database with no checkout and no worktree. "Check out as task"
 * is the deliberate step into local work.
 */
export function PullRequestsPanel({ projectPath }: PullRequestsPanelProps) {
  const availability = useGithubStore((s) => s.availability);
  const inbox = useGithubStore((s) => s.inbox);
  const inboxLoading = useGithubStore((s) => s.inboxLoading);
  const inboxError = useGithubStore((s) => s.inboxError);
  const issues = useGithubStore((s) => s.issues);
  const issuesLoading = useGithubStore((s) => s.issuesLoading);
  const issuesError = useGithubStore((s) => s.issuesError);
  const detailLoading = useGithubStore((s) => s.detailLoading);
  const detailError = useGithubStore((s) => s.detailError);
  const issueLoading = useGithubStore((s) => s.issueLoading);
  const issueDetailError = useGithubStore((s) => s.issueError);

  const linearAvailability = useLinearStore((s) => s.availability);
  const linearGroups = useLinearStore((s) => s.groups);
  const linearLoading = useLinearStore((s) => s.groupsLoading);
  const linearError = useLinearStore((s) => s.groupsError);
  const linearIssueLoading = useLinearStore((s) => s.issueLoading);
  const linearIssueError = useLinearStore((s) => s.issueError);

  const open = usePanelStore((s) => s.open);
  const listView = usePanelStore((s) => s.listView);
  const sidebarWidth = usePanelStore((s) => s.sidebarWidth);
  const sidebarCollapsed = usePanelStore((s) => s.sidebarCollapsed);

  // Keyed by the slot: data for something no longer open is stale, and the
  // pane it belongs to is not the one on screen.
  const detail = useGithubStore((s) =>
    open?.source === 'github-pr' && s.detail?.number === open.number ? s.detail : null,
  );
  const issue = useGithubStore((s) =>
    open?.source === 'github-issue' && s.issue?.number === open.number ? s.issue : null,
  );
  const linearIssue = useLinearStore((s) => (open?.source === 'linear' && s.issue?.id === open.id ? s.issue : null));

  useEffect(() => {
    useGithubStore.getState().setProject(projectPath);
    void useGithubStore.getState().loadAvailability(projectPath);
    useLinearStore.getState().setProject(projectPath);
    void useLinearStore.getState().loadAvailability(projectPath);
  }, [projectPath]);

  const available = availability?.available ?? false;
  const linearConnected = linearAvailability?.connected ?? false;

  // Both lists load together, so switching between them never waits on a fetch.
  useEffect(() => {
    if (!available) return;
    const store = useGithubStore.getState();
    void store.loadInbox(projectPath);
    void store.loadIssues(projectPath);
  }, [available, projectPath]);

  // Linear loads on the same terms: on open and on the refresh button, so two
  // sources in one list do not go stale at different rates.
  useEffect(() => {
    if (!linearConnected || !linearAvailability?.scope) return;
    void useLinearStore.getState().loadIssues(projectPath);
  }, [linearConnected, linearAvailability?.scope, projectPath]);

  const refresh = useCallback(() => {
    const store = useGithubStore.getState();
    // Re-probe `gh` rather than trusting the startup health cache: a cached
    // "not signed in" would outlive the user signing in and coming back.
    void store.loadAvailability(projectPath, true);
    void store.loadInbox(projectPath);
    void store.loadIssues(projectPath);
    void useLinearStore.getState().loadAvailability(projectPath, true);
    void useLinearStore.getState().loadIssues(projectPath);
  }, [projectPath]);

  // The one update that arrives unasked: a draft written by the CLI happens in
  // another process. The handler must stay a single local read — a network call
  // here turns every CLI write into a full refetch.
  useEffect(() => {
    if (!available) return;
    return window.api.github.onDraftsChanged((payload) => {
      if (payload.projectPath !== projectPath) return;
      const slot = usePanelStore.getState().open;
      if (slot?.source !== 'github-pr' || slot.number !== payload.prNumber) return;
      void useGithubStore.getState().loadDrafts(projectPath, payload.prNumber);
    });
  }, [available, projectPath]);

  const closeOpenItem = useCallback(() => {
    const slot = usePanelStore.getState().open;
    if (slot?.source === 'linear') useLinearStore.getState().closeDetail();
    else useGithubStore.getState().closeDetail();
  }, []);

  // The same push the GitHub side takes, for a comment staged against a Linear
  // issue by the CLI. One local read, no refetch.
  useEffect(() => {
    if (!linearConnected) return;
    return window.api.linear.onDraftsChanged((payload) => {
      if (payload.projectPath !== projectPath) return;
      const slot = usePanelStore.getState().open;
      if (slot?.source !== 'linear' || slot.id !== payload.issueId) return;
      void useLinearStore.getState().loadDrafts(projectPath, payload.issueId);
    });
  }, [linearConnected, projectPath]);

  // Closes what is open before leaving the panel behind it.
  useEscape(
    useCallback(() => {
      if (usePanelStore.getState().open) {
        closeOpenItem();
        return;
      }
      useProjectStore.getState().setActivePanel('terminals');
    }, [closeOpenItem]),
  );

  // The maps are built in a memo, not the selector: a selector returning a
  // fresh object never equals the last one and re-renders forever.
  const tasks = useProjectStore((s) => s.tasks);
  const { issueTasks, prTasks, linearTasks, tasksByNumber } = useMemo(() => {
    const issueTasks: Record<number, TaskWithWorkspace> = {};
    const prTasks: Record<number, TaskWithWorkspace> = {};
    const linearTasks: Record<string, TaskWithWorkspace> = {};
    const tasksByNumber: Record<number, TaskWithWorkspace> = {};
    for (const task of tasks) {
      if (task.githubIssueNumber != null) issueTasks[task.githubIssueNumber] = task;
      if (task.githubPrNumber != null) prTasks[task.githubPrNumber] = task;
      if (task.linearIssueId) linearTasks[task.linearIssueId] = task;
      tasksByNumber[task.taskNumber] = task;
    }
    return { issueTasks, prTasks, linearTasks, tasksByNumber };
  }, [tasks]);

  const repo = availability?.identity;
  const scopeName = linearAvailability?.scope?.name ?? null;
  const listGroups = useMemo(
    () =>
      issueGroups({
        github: issues,
        githubSlug: repo ? `${repo.owner}/${repo.repo}` : null,
        linear: linearGroups,
        linearScopeName: scopeName,
        githubTasks: issueTasks,
        linearTasks,
      }),
    [issues, repo, linearGroups, scopeName, issueTasks, linearTasks],
  );
  const issueCount = listGroups.reduce((total, group) => total + group.rows.length, 0);

  // The panel only renders for the project being viewed, so the active project
  // is the one a linked task belongs to.
  const project = useAppStore((s) => s.activeProjectData);

  const openLinkedTask = useCallback(
    (task: TaskWithWorkspace) => {
      if (!project) return;
      void activateTask(project, task);
    },
    [project],
  );

  const openTaskLabel = useCallback(
    (task: TaskWithWorkspace) => TASK_OPEN_LABEL[taskOpenAction(projectPath, task)],
    [projectPath],
  );

  const createTaskFromIssue = useCallback(
    async (issueNumber: number) => {
      const result = await window.api.github.taskFromIssue(projectPath, issueNumber);
      if (!result.success) {
        useProjectStore.getState().addToast(result.error ?? 'Could not create the task', 'error');
        return;
      }
      await useProjectStore.getState().loadTasks(projectPath);

      // Offer the jump rather than taking it: creating several tasks from a
      // list of issues in one pass is the common case.
      const created = useProjectStore.getState().tasks.find((t) => t.taskNumber === result.taskNumber);
      useProjectStore.getState().addToast(`Created task #${result.taskNumber} from issue #${issueNumber}`, {
        type: 'success',
        ...(created && project
          ? {
              actionLabel: TASK_OPEN_LABEL[taskOpenAction(projectPath, created)],
              onAction: () => void activateTask(project, created),
            }
          : {}),
      });
    },
    [projectPath, project],
  );

  const createTaskFromLinearIssue = useCallback(
    async (identifier: string) => {
      const result = await window.api.linear.taskFromIssue(projectPath, identifier);
      if (!result.success) {
        useProjectStore.getState().addToast(result.error ?? 'Could not create the task', 'error');
        return;
      }
      await useProjectStore.getState().loadTasks(projectPath);
      const created = useProjectStore.getState().tasks.find((t) => t.taskNumber === result.taskNumber);
      useProjectStore.getState().addToast(`Created task #${result.taskNumber} from ${identifier}`, {
        type: 'success',
        ...(created && project
          ? {
              actionLabel: TASK_OPEN_LABEL[taskOpenAction(projectPath, created)],
              onAction: () => void activateTask(project, created),
            }
          : {}),
      });
    },
    [projectPath, project],
  );

  /** A row addresses its issue in its own source's terms; opening dispatches on that. */
  const openIssueRow = useCallback(
    (row: IssueRow) => {
      if (row.source === 'linear') void useLinearStore.getState().openIssue(projectPath, row.key);
      else void useGithubStore.getState().openIssue(projectPath, Number(row.key));
    },
    [projectPath],
  );

  const createTaskFromRow = useCallback(
    (row: IssueRow) => {
      if (row.source === 'linear') void createTaskFromLinearIssue(row.identifier);
      else void createTaskFromIssue(Number(row.key));
    },
    [createTaskFromIssue, createTaskFromLinearIssue],
  );

  const promoteToTask = useCallback(async () => {
    const slot = usePanelStore.getState().open;
    if (slot?.source !== 'github-pr') return;
    const number = slot.number;
    const result = await window.api.github.taskFromPr(projectPath, number);
    if (!result.success || result.taskNumber == null) {
      useProjectStore.getState().addToast(result.error ?? 'Could not create the task', 'error');
      return;
    }
    // `headRef` is a local branch the main process just created at the PR's
    // head, so the worktree carries the PR's commits rather than branching off
    // whatever HEAD is.
    const start = await window.api.task.start(projectPath, result.taskNumber, result.headRef);
    await useProjectStore.getState().loadTasks(projectPath);
    if (!start.success) {
      useProjectStore
        .getState()
        .addToast(`Created task #${result.taskNumber}, but the worktree failed: ${start.error ?? ''}`.trim(), 'error');
      return;
    }
    useProjectStore.getState().addToast(`Checked out #${number} as task #${result.taskNumber}`, 'success');
    await useGithubStore.getState().loadInbox(projectPath);
  }, [projectPath]);

  const linkedTask = detail ? prTasks[detail.number] : undefined;
  const linkedIssueTask = issue ? issueTasks[issue.number] : undefined;

  // The panel opens for any source that can answer. Only when none can does the
  // notice take the whole pane — with Linear connected and `gh` absent there is
  // still an Issues list to read.
  if (availability && !available && !linearConnected) {
    return (
      <PanelFrame>
        <UnavailableNotice message={availability.message} reason={availability.reason} />
      </PanelFrame>
    );
  }

  // The availability probe is `gh --version` plus an auth check: a few hundred
  // milliseconds, too short to warrant a spinner.
  if (!availability) return <PanelFrame />;

  const error = listView === 'issues' ? (issuesError ?? linearError) : inboxError;
  const openDetail = detail || issue || linearIssue;
  const detailProblem = detailError ?? issueDetailError ?? linearIssueError;

  return (
    <PanelFrame>
      {!sidebarCollapsed && (
        <PullRequestSidebar
          needsReview={inbox?.needsReview ?? []}
          mine={inbox?.mine ?? []}
          others={inbox?.others ?? []}
          draftCounts={inbox?.draftCounts ?? {}}
          prTasks={prTasks}
          showing={listView}
          issueCount={issueCount}
          activeNumber={open?.source === 'github-pr' ? open.number : null}
          loading={listView === 'issues' ? issuesLoading || linearLoading : inboxLoading}
          onShow={(next) => usePanelStore.getState().setListView(next)}
          onOpenPullRequest={(n) => void useGithubStore.getState().openPullRequest(projectPath, n)}
          onOpenTask={openLinkedTask}
          issues={(query) => (
            <>
              {/* A row, never a modal: someone who opened the panel to read a
                  pull request is not made to configure a tracker first. */}
              {linearConnected && linearAvailability && !linearAvailability.scope && (
                <ConnectRow projectPath={projectPath} availability={linearAvailability} />
              )}
              <IssueList
                groups={listGroups}
                query={query}
                open={open}
                tasks={tasksByNumber}
                loading={issuesLoading || linearLoading}
                onOpen={openIssueRow}
                onOpenTask={openLinkedTask}
                onCreateTask={createTaskFromRow}
              />
            </>
          )}
          width={sidebarWidth}
        />
      )}

      {!sidebarCollapsed && (
        <ResizeHandle
          width={sidebarWidth}
          onWidth={(width) => usePanelStore.getState().setSidebarWidth(width)}
          min={SIDEBAR_MIN_WIDTH}
          max={SIDEBAR_MAX_WIDTH}
          defaultWidth={SIDEBAR_DEFAULT_WIDTH}
          label="Resize the list"
        />
      )}

      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        {/* `DetailChrome` carries the toggle when something is open. With
            nothing open there is no bar, and a collapsed list would otherwise
            leave no way back. */}
        {!openDetail && (
          <div className="pane-ledge relative z-30 shrink-0 h-12 flex items-center px-3">
            <SidebarToggle
              collapsed={sidebarCollapsed}
              onCollapsedChange={(collapsed) => usePanelStore.getState().setSidebarCollapsed(collapsed)}
              hideLabel="Hide the list"
              showLabel="Show the list"
              className="-ml-1"
            />
          </div>
        )}

        {/* The list error only takes the pane when nothing is open, so an inbox
          failure cannot discard the pull request being read. */}
        {error && !openDetail ? (
          <Centred>
            <Icon name="warning" className="w-6 h-6 text-vcs-modified opacity-70" />
            <p className="text-[15px] text-text-secondary max-w-sm text-center">{error}</p>
            <button type="button" className="btn-secondary btn-compact" onClick={refresh}>
              Try again
            </button>
          </Centred>
        ) : detailProblem ? (
          <Centred>
            <p className="text-[15px] text-text-secondary">{detailProblem}</p>
            <button type="button" className="btn-secondary btn-compact" onClick={closeOpenItem}>
              Close
            </button>
          </Centred>
        ) : linearIssue ? (
          <LinearIssueView
            projectPath={projectPath}
            issue={linearIssue}
            linkedTask={linearTasks[linearIssue.id]}
            openTaskLabel={openTaskLabel}
            onOpenTask={openLinkedTask}
            onCreateTask={() => void createTaskFromLinearIssue(linearIssue.identifier)}
          />
        ) : issue ? (
          <GithubIssueView
            projectPath={projectPath}
            issue={issue}
            linkedTask={linkedIssueTask}
            openTaskLabel={openTaskLabel}
            onOpenTask={openLinkedTask}
            onCreateTask={() => void createTaskFromIssue(issue.number)}
          />
        ) : detail ? (
          <PullRequestDetailView
            projectPath={projectPath}
            detail={detail}
            linkedTask={linkedTask}
            openTaskLabel={openTaskLabel}
            onOpenTask={openLinkedTask}
            onPromoteToTask={() => void promoteToTask()}
          />
        ) : detailLoading ? (
          <Loading label="Loading pull request" />
        ) : issueLoading || linearIssueLoading ? (
          <Loading label="Loading issue" />
        ) : !inbox && inboxLoading ? (
          <Loading label="Loading pull requests" />
        ) : (
          <Centred>
            <Icon name="git-pull-request" className="w-8 h-8 text-text-tertiary opacity-30" />
            <p className="text-[15px] text-text-tertiary">Pick something from the list</p>
            <span className="flex items-center gap-2 text-[13px] text-text-tertiary">
              {availability.identity ? `${availability.identity.owner}/${availability.identity.repo}` : ''}
              <RefreshButton busy={inboxLoading || issuesLoading} onClick={refresh} />
            </span>
          </Centred>
        )}
      </div>
    </PanelFrame>
  );
}

function Centred({ children }: { children: ReactNode }) {
  return <div className="flex-1 min-w-0 flex flex-col items-center justify-center gap-3 px-6">{children}</div>;
}

function UnavailableNotice({ message, reason }: { message?: string; reason?: string }) {
  return (
    <Centred>
      <Icon name="git-pull-request" className="w-8 h-8 text-text-tertiary opacity-40" />
      <p className="text-[15px] text-text-secondary max-w-sm text-center">
        {message ?? 'GitHub is not available for this project.'}
      </p>
      {reason === 'gh-missing' && (
        <button
          type="button"
          className="btn-secondary btn-compact"
          onClick={() => void window.api.openExternal('https://cli.github.com')}
        >
          Get the GitHub CLI
        </button>
      )}
    </Centred>
  );
}
