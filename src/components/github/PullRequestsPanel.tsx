import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { useGithubStore, SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH } from '../../stores/githubStore';
import { useProjectStore } from '../../stores/projectStore';
import { ResizeHandle } from '../common/ResizeHandle';
import { SidebarToggle } from '../common/SidebarToggle';
import { useAppStore } from '../../stores/appStore';
import { activateTask, taskOpenAction, TASK_OPEN_LABEL } from '../navigation';
import { Icon } from '../terminal/Icon';
import { PullRequestSidebar } from './PullRequestSidebar';
import { PullRequestDetailView } from './PullRequestDetailView';
import { IssueDetailView } from './IssueDetailView';
import type { TaskWithWorkspace } from '../../types';
import { PanelFrame } from '../ui/PanelFrame';
import { useEscape } from '../../hooks/useEscape';
import { RefreshButton } from './RefreshButton';
import { Loading } from './Loading';

interface PullRequestsPanelProps {
  projectPath: string;
}

/**
 * The GitHub surface: the list on the left, whatever is open on the right.
 *
 * Reviewing leaves nothing behind but the fetched refs — the diff is read out
 * of the object database with no checkout and no worktree. "Check out as task"
 * is the deliberate step into local work.
 */
export function PullRequestsPanel({ projectPath }: PullRequestsPanelProps) {
  const availability = useGithubStore((s) => s.availability);
  const view = useGithubStore((s) => s.view);
  const listView = useGithubStore((s) => s.listView);
  const inbox = useGithubStore((s) => s.inbox);
  const inboxLoading = useGithubStore((s) => s.inboxLoading);
  const inboxError = useGithubStore((s) => s.inboxError);
  const issues = useGithubStore((s) => s.issues);
  const issuesLoading = useGithubStore((s) => s.issuesLoading);
  const issuesError = useGithubStore((s) => s.issuesError);
  const activeNumber = useGithubStore((s) => s.activeNumber);
  const detail = useGithubStore((s) => s.detail);
  const detailLoading = useGithubStore((s) => s.detailLoading);
  const detailError = useGithubStore((s) => s.detailError);
  const activeIssue = useGithubStore((s) => s.activeIssue);
  const sidebarWidth = useGithubStore((s) => s.sidebarWidth);
  const sidebarCollapsed = useGithubStore((s) => s.sidebarCollapsed);
  const issue = useGithubStore((s) => s.issue);
  const issueLoading = useGithubStore((s) => s.issueLoading);
  const issueDetailError = useGithubStore((s) => s.issueError);

  useEffect(() => {
    const store = useGithubStore.getState();
    store.setProject(projectPath);
    void store.loadAvailability(projectPath);
  }, [projectPath]);

  const available = availability?.available ?? false;

  // Both lists load together, so switching between them never waits on a fetch.
  useEffect(() => {
    if (!available) return;
    const store = useGithubStore.getState();
    void store.loadInbox(projectPath);
    void store.loadIssues(projectPath);
  }, [available, projectPath]);

  const refresh = useCallback(() => {
    const store = useGithubStore.getState();
    // Re-probe `gh` rather than trusting the startup health cache: a cached
    // "not signed in" would outlive the user signing in and coming back.
    void store.loadAvailability(projectPath, true);
    void store.loadInbox(projectPath);
    void store.loadIssues(projectPath);
  }, [projectPath]);

  // The one update that arrives unasked: a draft written by the CLI happens in
  // another process. The handler must stay a single local read — a network call
  // here turns every CLI write into a full refetch.
  useEffect(() => {
    if (!available) return;
    return window.api.github.onDraftsChanged((payload) => {
      if (payload.projectPath !== projectPath) return;
      const store = useGithubStore.getState();
      if (store.activeNumber !== payload.prNumber) return;
      void store.loadDrafts(projectPath, payload.prNumber);
    });
  }, [available, projectPath]);

  // Closes what is open before leaving the panel behind it.
  useEscape(
    useCallback(() => {
      const store = useGithubStore.getState();
      if (store.activeNumber != null || store.activeIssue != null) {
        store.closeDetail();
        return;
      }
      useProjectStore.getState().setActivePanel('terminals');
    }, []),
  );

  // The maps are built in a memo, not the selector: a selector returning a
  // fresh object never equals the last one and re-renders forever.
  const tasks = useProjectStore((s) => s.tasks);
  const { issueTasks, prTasks } = useMemo(() => {
    const issueTasks: Record<number, TaskWithWorkspace> = {};
    const prTasks: Record<number, TaskWithWorkspace> = {};
    for (const task of tasks) {
      if (task.githubIssueNumber != null) issueTasks[task.githubIssueNumber] = task;
      if (task.githubPrNumber != null) prTasks[task.githubPrNumber] = task;
    }
    return { issueTasks, prTasks };
  }, [tasks]);

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

  const promoteToTask = useCallback(async () => {
    const number = useGithubStore.getState().activeNumber;
    if (number == null) return;
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

  if (availability && !available) {
    return (
      <PanelFrame>
        <UnavailableNotice message={availability.message} reason={availability.reason} />
      </PanelFrame>
    );
  }

  // The availability probe is `gh --version` plus an auth check: a few hundred
  // milliseconds, too short to warrant a spinner.
  if (!availability) return <PanelFrame />;

  const showing = view === 'detail' ? listView : view;
  const error = showing === 'issues' ? issuesError : inboxError;

  return (
    <PanelFrame>
      {!sidebarCollapsed && (
        <PullRequestSidebar
          needsReview={inbox?.needsReview ?? []}
          mine={inbox?.mine ?? []}
          others={inbox?.others ?? []}
          issues={issues}
          draftCounts={inbox?.draftCounts ?? {}}
          prTasks={prTasks}
          issueTasks={issueTasks}
          showing={showing === 'issues' ? 'issues' : 'pulls'}
          activeNumber={activeNumber}
          activeIssue={activeIssue}
          loading={showing === 'issues' ? issuesLoading : inboxLoading}
          onShow={(next) => useGithubStore.getState().setView(next === 'issues' ? 'issues' : 'inbox')}
          onOpenPullRequest={(n) => void useGithubStore.getState().openPullRequest(projectPath, n)}
          onOpenIssue={(row) => void useGithubStore.getState().openIssue(projectPath, row.number)}
          onCreateTaskFromIssue={(n) => void createTaskFromIssue(n)}
          onOpenTask={openLinkedTask}
          width={sidebarWidth}
        />
      )}

      {!sidebarCollapsed && (
        <ResizeHandle
          width={sidebarWidth}
          onWidth={(width) => useGithubStore.getState().setSidebarWidth(width)}
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
        {!detail && !issue && (
          <div className="pane-ledge relative z-30 shrink-0 h-12 flex items-center px-3">
            <SidebarToggle
              collapsed={sidebarCollapsed}
              onCollapsedChange={(collapsed) => useGithubStore.getState().setSidebarCollapsed(collapsed)}
              hideLabel="Hide the list"
              showLabel="Show the list"
              className="-ml-1"
            />
          </div>
        )}

        {/* The list error only takes the pane when nothing is open, so an inbox
          failure cannot discard the pull request being read. */}
        {error && !detail && !issue ? (
          <Centred>
            <Icon name="warning" className="w-6 h-6 text-vcs-modified opacity-70" />
            <p className="text-[15px] text-text-secondary max-w-sm text-center">{error}</p>
            <button type="button" className="btn-secondary btn-compact" onClick={refresh}>
              Try again
            </button>
          </Centred>
        ) : detailError || issueDetailError ? (
          <Centred>
            <p className="text-[15px] text-text-secondary">{detailError ?? issueDetailError}</p>
            <button
              type="button"
              className="btn-secondary btn-compact"
              onClick={() => useGithubStore.getState().closeDetail()}
            >
              Close
            </button>
          </Centred>
        ) : issue ? (
          <IssueDetailView
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
        ) : issueLoading ? (
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
