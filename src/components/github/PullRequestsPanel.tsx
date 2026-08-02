import { useCallback, useEffect, useMemo } from 'react';
import { useGithubStore } from '../../stores/githubStore';
import { useProjectStore } from '../../stores/projectStore';
import { Icon } from '../terminal/Icon';
import { PullRequestList } from './PullRequestList';
import { PullRequestDetailView } from './PullRequestDetailView';
import { IssueList } from './IssueList';

interface PullRequestsPanelProps {
  projectPath: string;
}

/**
 * The GitHub surface, mounted as a project panel the same way project settings
 * is.
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

  useEffect(() => {
    if (!available) return;
    void useGithubStore.getState().loadInbox(projectPath);
  }, [available, projectPath]);

  useEffect(() => {
    if (!available || view !== 'issues') return;
    void useGithubStore.getState().loadIssues(projectPath);
  }, [available, view, projectPath]);

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

  // Escape returns to the list, then out of the panel — matching how the
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

  const issueLinkedTasks = useProjectStore(
    useCallback((s) => {
      const map: Record<number, number> = {};
      for (const task of s.tasks) {
        if (task.githubIssueNumber != null) map[task.githubIssueNumber] = task.taskNumber;
      }
      return map;
    }, []),
  );

  const createTaskFromIssue = useCallback(
    async (issueNumber: number) => {
      const result = await window.api.github.taskFromIssue(projectPath, issueNumber);
      if (!result.success) {
        useProjectStore.getState().addToast(result.error ?? 'Could not create the task', 'error');
        return;
      }
      useProjectStore.getState().addToast(`Created task #${result.taskNumber} from issue #${issueNumber}`, 'success');
      await useProjectStore.getState().loadTasks(projectPath);
    },
    [projectPath],
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

  const linkedTask = useMemo(() => {
    const number = detail?.number;
    if (number == null) return undefined;
    return inbox?.linkedTasks[number];
  }, [detail?.number, inbox]);

  if (availability && !available) {
    return <UnavailableNotice message={availability.message} reason={availability.reason} />;
  }

  if (!availability) {
    return (
      <div className="flex flex-col h-full items-center justify-center text-text-tertiary">
        Checking GitHub availability…
      </div>
    );
  }

  if (view === 'detail') {
    if (detailLoading && !detail) {
      return (
        <div className="flex flex-col h-full items-center justify-center text-text-tertiary">Loading pull request…</div>
      );
    }
    if (detailError) {
      return (
        <div className="flex flex-col h-full items-center justify-center gap-3 text-text-tertiary">
          <span className="text-sm">{detailError}</span>
          <button
            type="button"
            className="text-xs px-3 py-1.5 rounded-md bg-ink/[0.08] text-text-primary"
            onClick={() => useGithubStore.getState().closeDetail()}
          >
            Back to pull requests
          </button>
        </div>
      );
    }
    if (detail) {
      return (
        <div className="flex flex-col h-full" style={{ marginLeft: 'var(--sidebar-offset, 0px)' }}>
          <PullRequestDetailView
            projectPath={projectPath}
            detail={detail}
            linkedTask={linkedTask}
            onPromoteToTask={() => void promoteToTask()}
          />
        </div>
      );
    }
  }

  return (
    <div
      className="flex flex-col h-full transition-[margin-left] duration-200 ease-out"
      style={{ marginLeft: 'var(--sidebar-offset, 0px)' }}
    >
      <div
        className="pointer-events-none h-6 shrink-0 -mb-6 relative z-10"
        style={{ background: 'linear-gradient(to bottom, var(--color-background), transparent)' }}
      />
      <div className="flex-1 overflow-y-auto">
        <div className="px-6 pt-4 pb-16 max-w-3xl">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex items-center h-8 bg-background-secondary glass-bevel relative border border-bezel rounded-[12px] overflow-hidden">
              <TabButton active={view === 'inbox'} onClick={() => useGithubStore.getState().setView('inbox')}>
                Pull requests
              </TabButton>
              <TabButton active={view === 'issues'} onClick={() => useGithubStore.getState().setView('issues')}>
                Issues
              </TabButton>
            </div>
            <span className="text-xs text-text-tertiary font-mono">
              {availability.identity ? `${availability.identity.owner}/${availability.identity.repo}` : ''}
            </span>
            <button
              type="button"
              className="ml-auto w-7 h-7 rounded-md text-text-secondary flex items-center justify-center hover:bg-ink/10 hover:text-text-primary transition-all duration-150"
              title="Refresh"
              onClick={() => {
                const store = useGithubStore.getState();
                if (view === 'issues') void store.loadIssues(projectPath);
                else void store.loadInbox(projectPath);
              }}
            >
              <Icon name="arrows-clockwise" />
            </button>
          </div>

          {view === 'issues' ? (
            issuesLoading && issues.length === 0 ? (
              <p className="text-sm text-text-tertiary">Loading issues…</p>
            ) : issuesError ? (
              <p className="text-sm text-vcs-deleted">{issuesError}</p>
            ) : (
              <IssueList
                issues={issues}
                linkedTasks={issueLinkedTasks}
                onCreateTask={(n) => void createTaskFromIssue(n)}
                onOpenExternal={(url) => void window.api.openExternal(url)}
              />
            )
          ) : inboxLoading && !inbox ? (
            <p className="text-sm text-text-tertiary">Loading pull requests…</p>
          ) : inboxError ? (
            <p className="text-sm text-vcs-deleted">{inboxError}</p>
          ) : inbox ? (
            <PullRequestList
              needsReview={inbox.needsReview}
              mine={inbox.mine}
              others={inbox.others}
              draftCounts={inbox.draftCounts}
              linkedTasks={inbox.linkedTasks}
              onOpen={(n) => void useGithubStore.getState().openPullRequest(projectPath, n)}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className={`px-3 h-full text-xs transition-colors duration-100 ${
        active ? 'text-text-primary bg-background-tertiary' : 'text-text-secondary hover:text-text-primary'
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/**
 * Why the panel is empty, said plainly. The alternative — a blank screen when
 * `gh` is missing or logged out — is the failure this exists to avoid.
 */
function UnavailableNotice({ message, reason }: { message?: string; reason?: string }) {
  return (
    <div
      className="flex flex-col h-full items-center justify-center gap-3 px-6 text-center"
      style={{ marginLeft: 'var(--sidebar-offset, 0px)' }}
    >
      <Icon name="git-pull-request" className="w-8 h-8 text-text-tertiary opacity-40" />
      <p className="text-sm text-text-secondary max-w-sm">{message ?? 'GitHub is not available for this project.'}</p>
      {reason === 'gh-missing' && (
        <button
          type="button"
          className="text-xs px-3 py-1.5 rounded-md bg-ink/[0.08] text-text-primary hover:bg-ink/[0.12]"
          onClick={() => void window.api.openExternal('https://cli.github.com')}
        >
          Get the GitHub CLI
        </button>
      )}
    </div>
  );
}
