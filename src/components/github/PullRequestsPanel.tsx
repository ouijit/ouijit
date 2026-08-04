import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { useGithubStore } from '../../stores/githubStore';
import { useProjectStore } from '../../stores/projectStore';
import { useAppStore } from '../../stores/appStore';
import { activateTask, taskOpenAction, TASK_OPEN_LABEL } from '../navigation';
import { Icon } from '../terminal/Icon';
import { PullRequestSidebar } from './PullRequestSidebar';
import { PullRequestDetailView } from './PullRequestDetailView';
import { IssueDetailView } from './IssueDetailView';
import type { TaskWithWorkspace } from '../../types';
import { RefreshButton } from './RefreshButton';
import { Loading } from './Loading';

interface PullRequestsPanelProps {
  projectPath: string;
}

/**
 * The GitHub surface: the list on the left, whatever you opened on the right.
 *
 * The list stays put. Review is a queue you work down, and replacing it with
 * the thing you just opened loses your place every time.
 *
 * Reviewing a teammate's PR here is ephemeral: the diff is read straight out of
 * the object database with no checkout and no worktree, and the session leaves
 * nothing behind but the fetched refs. "Check out as task" is the deliberate
 * step from that into real local work.
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
  const issue = useGithubStore((s) => s.issue);
  const issueLoading = useGithubStore((s) => s.issueLoading);
  const issueDetailError = useGithubStore((s) => s.issueError);

  useEffect(() => {
    const store = useGithubStore.getState();
    store.setProject(projectPath);
    void store.loadAvailability(projectPath);
  }, [projectPath]);

  const available = availability?.available ?? false;

  // Both loads start together so either list is ready the moment it is asked
  // for, and the sidebar never waits on a fetch to switch.
  useEffect(() => {
    if (!available) return;
    const store = useGithubStore.getState();
    void store.loadInbox(projectPath);
    void store.loadIssues(projectPath);
  }, [available, projectPath]);

  const refresh = useCallback(() => {
    const store = useGithubStore.getState();
    // Re-probe `gh` rather than trusting the startup health cache: the
    // unavailable message tells the user to sign in and come back, and a
    // cached "not signed in" would outlive them doing exactly that.
    void store.loadAvailability(projectPath, true);
    void store.loadInbox(projectPath);
    void store.loadIssues(projectPath);
  }, [projectPath]);

  // Refresh when the poller reports movement, and again whenever the window
  // regains focus — the two fast paths that let the poll interval stay slow.
  useEffect(() => {
    if (!available) return;
    const off = window.api.github.onChanged((payload) => {
      if (payload.projectPath !== projectPath) return;
      const store = useGithubStore.getState();
      void store.loadInbox(projectPath);
      void store.loadIssues(projectPath);
      if (store.activeNumber != null) void store.reloadDetail(projectPath);
      if (store.activeIssue != null) void store.reloadIssue(projectPath);
    });
    const onFocus = () => {
      if (document.hidden) return;
      void useGithubStore.getState().loadInbox(projectPath);
    };
    window.addEventListener('focus', onFocus);
    return () => {
      off();
      window.removeEventListener('focus', onFocus);
    };
  }, [available, projectPath]);

  // Escape closes what is open, then leaves the panel — matching how the
  // settings panel treats Escape.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // A comment box, a menu or the search field takes Escape first and stops
      // it; without this the same keypress that cancelled a comment also threw
      // you out of the pull request.
      if (e.defaultPrevented) return;
      const store = useGithubStore.getState();
      if (store.activeNumber != null || store.activeIssue != null) {
        store.closeDetail();
        return;
      }
      useProjectStore.getState().setActivePanel('terminals');
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Select the array (a stable reference from the store) and build the maps in
  // a memo. Building them inside the selector would return a fresh object on
  // every store read, which never equals the last one and re-renders forever.
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

  // The panel only ever renders for the project being viewed, so the active
  // project is the one a linked task belongs to.
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
      // list of issues in one pass is the common case, and navigating away on
      // the first one would break that.
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
    // head, so the worktree is built from the PR's commits rather than from a
    // new empty branch off whatever HEAD is. The merge target was stored with
    // the task and `startTask` no longer overwrites one that is already set.
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
      <Frame>
        <UnavailableNotice message={availability.message} reason={availability.reason} />
      </Frame>
    );
  }

  // The availability probe is a `gh --version` plus an auth check, normally a
  // few hundred milliseconds. A message would flash; an empty frame doesn't.
  if (!availability) return <Frame />;

  const showing = view === 'detail' ? listView : view;
  const error = showing === 'issues' ? issuesError : inboxError;

  return (
    <Frame>
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
      />

      {/* The list error only takes the pane when nothing is open. A poll-driven
          inbox failure used to discard the pull request you were reading,
          which is the opposite of what `reloadDetail` deliberately does. */}
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
    </Frame>
  );
}

/**
 * The panel surface, pinned exactly where the kanban board is pinned. Switching
 * between the two with the title bar toggle should move what is inside the
 * frame, not the frame.
 */
function Frame({ children }: { children?: ReactNode }) {
  return (
    <div
      className="glass-bevel fixed top-[82px] bottom-4 z-[140] flex rounded-[14px] overflow-hidden border border-bezel-panel"
      style={{
        left: 'calc(var(--sidebar-offset, 0px) + 16px)',
        right: 16,
        transition: 'left 0.2s ease-out',
        background: 'var(--color-terminal-bg)',
        boxShadow: 'var(--shadow-panel)',
      }}
    >
      {children}
    </div>
  );
}

function Centred({ children }: { children: ReactNode }) {
  return <div className="flex-1 min-w-0 flex flex-col items-center justify-center gap-3 px-6">{children}</div>;
}

/**
 * Why the panel is empty, said plainly. The alternative — a blank screen when
 * `gh` is missing or logged out — is the failure this exists to avoid.
 */
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
