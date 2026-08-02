import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { useGithubStore } from '../../stores/githubStore';
import { useProjectStore } from '../../stores/projectStore';
import { useAppStore } from '../../stores/appStore';
import { activateTask, taskOpenAction, TASK_OPEN_LABEL } from '../navigation';
import { Icon } from '../terminal/Icon';
import { GithubBoard } from './GithubBoard';
import { PullRequestDetailView } from './PullRequestDetailView';
import type { TaskWithWorkspace } from '../../types';
import { RefreshButton } from './RefreshButton';
import { Loading } from './Loading';

interface PullRequestsPanelProps {
  projectPath: string;
}

/**
 * The GitHub surface: a board framed the same way the kanban board is, in the
 * same slot, with the same columns and the same cards.
 *
 * Reviewing a teammate's PR here is ephemeral: the diff is read straight out of
 * the object database with no checkout and no worktree, and the session leaves
 * nothing behind but the fetched refs. "Check out as task" is the deliberate
 * step from that into real local work.
 */
export function PullRequestsPanel({ projectPath }: PullRequestsPanelProps) {
  const availability = useGithubStore((s) => s.availability);
  const view = useGithubStore((s) => s.view);
  const inbox = useGithubStore((s) => s.inbox);
  const inboxLoading = useGithubStore((s) => s.inboxLoading);
  const inboxError = useGithubStore((s) => s.inboxError);
  const issues = useGithubStore((s) => s.issues);
  const issuesLoading = useGithubStore((s) => s.issuesLoading);
  const issuesError = useGithubStore((s) => s.issuesError);
  const detail = useGithubStore((s) => s.detail);
  const detailLoading = useGithubStore((s) => s.detailLoading);
  const detailError = useGithubStore((s) => s.detailError);

  useEffect(() => {
    const store = useGithubStore.getState();
    store.setProject(projectPath);
    void store.loadAvailability(projectPath);
  }, [projectPath]);

  const available = availability?.available ?? false;

  // Both loads start together: the board shows pull requests and issues at
  // once, so deferring either one would leave a column empty on arrival.
  useEffect(() => {
    if (!available) return;
    const store = useGithubStore.getState();
    void store.loadInbox(projectPath);
    void store.loadIssues(projectPath);
  }, [available, projectPath]);

  const refresh = useCallback(() => {
    const store = useGithubStore.getState();
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
      if (store.activeNumber != null) void store.reloadDetail(projectPath);
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

  // Escape returns to the board, then out of the panel — matching how the
  // settings panel treats Escape.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const store = useGithubStore.getState();
      if (store.view === 'detail') {
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
    // The task is created as a todo; starting it builds the worktree at the PR
    // head with mergeTarget already pointing at the PR's base.
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

  if (availability && !available) {
    return (
      <BoardFrame>
        <UnavailableNotice message={availability.message} reason={availability.reason} />
      </BoardFrame>
    );
  }

  // The availability probe is a `gh --version` plus an auth check, normally a
  // few hundred milliseconds. A message would flash; an empty frame doesn't.
  if (!availability) return <BoardFrame />;

  if (view === 'detail') {
    return (
      <BoardFrame>
        {detailError ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-text-tertiary">
            <span className="text-sm">{detailError}</span>
            <button
              type="button"
              className="font-mono text-[11px] text-text-secondary hover:text-text-primary underline underline-offset-2"
              onClick={() => useGithubStore.getState().closeDetail()}
            >
              Back to the board
            </button>
          </div>
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
        ) : null}
      </BoardFrame>
    );
  }

  return (
    <BoardFrame>
      {inboxError ? (
        <ErrorNotice message={inboxError} onRetry={refresh} />
      ) : !inbox ? (
        <Loading label="Loading pull requests" />
      ) : (
        <GithubBoard
          needsReview={inbox.needsReview}
          mine={inbox.mine}
          others={inbox.others}
          issues={issues}
          draftCounts={inbox.draftCounts}
          prTasks={prTasks}
          issueTasks={issueTasks}
          issuesLoading={issuesLoading}
          issuesError={issuesError}
          openTaskLabel={openTaskLabel}
          onOpenPullRequest={(n) => void useGithubStore.getState().openPullRequest(projectPath, n)}
          onOpenTask={openLinkedTask}
          onCreateTaskFromIssue={(n) => void createTaskFromIssue(n)}
          onOpenExternal={(url) => void window.api.openExternal(url)}
          onRetryIssues={() => void useGithubStore.getState().loadIssues(projectPath)}
        />
      )}

      <BoardFooter
        slug={availability.identity ? `${availability.identity.owner}/${availability.identity.repo}` : ''}
        busy={inboxLoading || issuesLoading}
        onRefresh={refresh}
      />
    </BoardFrame>
  );
}

/**
 * The panel surface, pinned exactly where the kanban board is pinned. Switching
 * between the two with the title bar toggle should move what is inside the
 * frame, not the frame.
 */
function BoardFrame({ children }: { children?: ReactNode }) {
  return (
    <div
      className="glass-bevel fixed top-[82px] bottom-4 z-[140] flex flex-col rounded-[14px] overflow-hidden border border-bezel-panel"
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

/** Footer strip: which repo the board is showing, and the way to re-ask. */
function BoardFooter({ slug, busy, onRefresh }: { slug: string; busy: boolean; onRefresh: () => void }) {
  return (
    <div
      className="shrink-0 flex items-center gap-2 px-3 py-1.5"
      style={{ borderTop: '1px solid color-mix(in srgb, var(--color-ink) 6%, transparent)' }}
    >
      <span className="flex items-center gap-1.5 min-w-0 text-text-tertiary [&>svg]:w-3.5 [&>svg]:h-3.5 [&>svg]:shrink-0">
        <Icon name="git-pull-request" />
        <span className="font-mono text-[11px] truncate min-w-0">{slug}</span>
      </span>
      <span className="ml-auto shrink-0">
        <RefreshButton busy={busy} onClick={onRefresh} />
      </span>
    </div>
  );
}

/** A failed fetch, with the retry the user would otherwise hunt for. */
function ErrorNotice({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
      <Icon name="warning" className="w-6 h-6 text-vcs-modified opacity-70" />
      <p className="text-sm text-text-secondary max-w-sm">{message}</p>
      <button
        type="button"
        className="font-mono text-[11px] text-text-secondary hover:text-text-primary underline underline-offset-2"
        onClick={onRetry}
      >
        Try again
      </button>
    </div>
  );
}

/**
 * Why the panel is empty, said plainly. The alternative — a blank screen when
 * `gh` is missing or logged out — is the failure this exists to avoid.
 */
function UnavailableNotice({ message, reason }: { message?: string; reason?: string }) {
  return (
    <div className="flex flex-col flex-1 items-center justify-center gap-3 px-6 text-center">
      <Icon name="git-pull-request" className="w-8 h-8 text-text-tertiary opacity-40" />
      <p className="text-sm text-text-secondary max-w-sm">{message ?? 'GitHub is not available for this project.'}</p>
      {reason === 'gh-missing' && (
        <button
          type="button"
          className="font-mono text-[11px] text-text-secondary hover:text-text-primary underline underline-offset-2"
          onClick={() => void window.api.openExternal('https://cli.github.com')}
        >
          Get the GitHub CLI
        </button>
      )}
    </div>
  );
}
