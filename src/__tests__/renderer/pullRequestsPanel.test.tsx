import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

vi.mock('electron-log/renderer', () => ({
  default: { scope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('../../components/navigation', async () => {
  const actual = await vi.importActual<typeof import('../../components/navigation')>('../../components/navigation');
  return { ...actual, activateTask: vi.fn().mockResolvedValue(undefined) };
});

import { PullRequestsPanel } from '../../components/github/PullRequestsPanel';
import { activateTask } from '../../components/navigation';
import { useAppStore } from '../../stores/appStore';
import { useGithubStore } from '../../stores/githubStore';
import { useProjectStore } from '../../stores/projectStore';
import type { PullRequestDetail, PullRequestSummary, TaskWithWorkspace } from '../../types';
import type { InboxResult } from '../../github/service';

const PROJECT = '/work/alpha';

function pr(over: Partial<PullRequestSummary> & { number: number }): PullRequestSummary {
  return {
    title: `PR ${over.number}`,
    state: 'open',
    isDraft: false,
    author: 'someone',
    headRefName: `feat-${over.number}`,
    baseRefName: 'main',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-02T00:00:00.000Z',
    url: `https://github.com/o/r/pull/${over.number}`,
    additions: 1,
    deletions: 1,
    changedFiles: 1,
    commentCount: 0,
    reviewDecision: null,
    checksState: 'none',
    labels: [],
    isMine: false,
    reviewRequested: false,
    ...over,
  };
}

function inbox(over: Partial<InboxResult> = {}): InboxResult {
  return {
    viewer: 'me',
    needsReview: [],
    mine: [],
    others: [],
    draftCounts: {},
    linkedTasks: {},
    ...over,
  };
}

function detail(over: Partial<PullRequestDetail> = {}): PullRequestDetail {
  return {
    ...pr({ number: 5 }),
    body: 'why this change exists',
    baseSha: 'aaa',
    headSha: 'bbb',
    threads: [],
    timeline: [],
    checks: [],
    merge: { mergeable: 'MERGEABLE', blockers: [] },
    ...over,
  };
}

function task(over: Partial<TaskWithWorkspace> & { taskNumber: number }): TaskWithWorkspace {
  return {
    name: `Task ${over.taskNumber}`,
    status: 'todo',
    createdAt: '2026-07-01T00:00:00.000Z',
    ...over,
  };
}

describe('PullRequestsPanel', () => {
  beforeEach(() => {
    cleanup();
    // The mocked api is module-level in the renderer setup, so call records
    // carry across tests unless they're cleared here.
    vi.clearAllMocks();
    useGithubStore.getState().reset();
    useGithubStore.setState({ projectPath: null });
    useProjectStore.setState({ tasks: [] });
    useAppStore.setState({ activeProjectData: { path: PROJECT, name: 'Alpha' } });
    vi.mocked(window.api.github.availability).mockResolvedValue({
      available: true,
      identity: { host: 'github.com', owner: 'o', repo: 'r' },
    });
    vi.mocked(window.api.github.inbox).mockResolvedValue(inbox());
    vi.mocked(window.api.github.issues).mockResolvedValue([]);
    vi.mocked(window.api.github.onChanged).mockReturnValue(() => {});
  });

  /**
   * Regression: the issue→task lookup was built inside a zustand selector, so
   * every store read returned a fresh object, never compared equal to the last
   * one, and re-rendered until React tore the whole view down with "Maximum
   * update depth exceeded". Mounting with tasks present is what reproduces it.
   */
  test('mounts without a render loop when tasks are present', async () => {
    useProjectStore.setState({
      tasks: [task({ taskNumber: 1, githubIssueNumber: 7 }), task({ taskNumber: 2 })],
    });

    const errors: unknown[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args[0]));

    render(<PullRequestsPanel projectPath={PROJECT} />);

    await waitFor(() => {
      expect(window.api.github.inbox).toHaveBeenCalledWith(PROJECT);
    });

    const loopError = errors.find((e) => String(e).includes('Maximum update depth'));
    expect(loopError).toBeUndefined();
    spy.mockRestore();
  });

  test('groups the sidebar and only shows groups with rows', async () => {
    vi.mocked(window.api.github.inbox).mockResolvedValue(
      inbox({
        needsReview: [pr({ number: 1, title: 'Needs a look', reviewRequested: true })],
        mine: [pr({ number: 2, title: 'Mine to land', isMine: true, author: 'me' })],
      }),
    );

    render(<PullRequestsPanel projectPath={PROJECT} />);

    expect(await screen.findByText('Needs a look')).toBeTruthy();
    expect(screen.getByText('Mine to land')).toBeTruthy();
    expect(screen.getByText('Needs your review')).toBeTruthy();
    expect(screen.getByText('Authored')).toBeTruthy();
    // No PRs landed in the third bucket, so its header must not render.
    expect(screen.queryByText('Everything else')).toBeNull();
  });

  /**
   * A broken or missing avatar URL must not leave a hole in the row: the
   * fallback is the initial, so every person is still distinguishable.
   */
  test('rows carry an avatar, and fall back to the initial without one', async () => {
    vi.mocked(window.api.github.inbox).mockResolvedValue(
      inbox({
        needsReview: [
          pr({ number: 1, title: 'With a face', author: 'octo', authorAvatarUrl: 'https://x/a.png' }),
          pr({ number: 2, title: 'Without one', author: 'ghost' }),
        ],
      }),
    );

    render(<PullRequestsPanel projectPath={PROJECT} />);
    await screen.findByText('With a face');

    const image = document.querySelector('img[src^="https://x/a.png"]') as HTMLImageElement | null;
    expect(image).not.toBeNull();
    // Requested at twice the rendered size, and without a referrer.
    expect(image!.src).toContain('s=32');
    expect(image!.getAttribute('referrerpolicy')).toBe('no-referrer');

    expect(screen.getByTitle('ghost').textContent).toBe('G');
  });

  test('shows a spinner on a first load, not on a refresh', async () => {
    let release!: (value: InboxResult) => void;
    vi.mocked(window.api.github.inbox).mockReturnValueOnce(
      new Promise<InboxResult>((resolve) => {
        release = resolve;
      }),
    );

    render(<PullRequestsPanel projectPath={PROJECT} />);

    // First load: nothing to show yet, so placeholders stand in.
    expect(await screen.findByLabelText('Loading pull requests')).toBeTruthy();

    release(inbox({ mine: [pr({ number: 3, title: 'Already on screen', isMine: true })] }));
    expect(await screen.findByText('Already on screen')).toBeTruthy();
    expect(screen.queryByLabelText('Loading pull requests')).toBeNull();

    // Refresh: the row the user is reading stays put. Replacing it with
    // placeholders would throw away content to announce a re-fetch that the
    // spinning button already reports.
    vi.mocked(window.api.github.inbox).mockReturnValueOnce(new Promise<InboxResult>(() => {}));
    fireEvent.click(screen.getByTitle('Refresh'));

    await waitFor(() => {
      expect(window.api.github.inbox).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByText('Already on screen')).toBeTruthy();
    expect(screen.queryByLabelText('Loading pull requests')).toBeNull();
  });

  test('offers a retry when the fetch fails', async () => {
    vi.mocked(window.api.github.inbox).mockRejectedValueOnce(new Error('Could not reach GitHub.'));

    render(<PullRequestsPanel projectPath={PROJECT} />);

    expect(await screen.findByText('Could not reach GitHub.')).toBeTruthy();

    vi.mocked(window.api.github.inbox).mockResolvedValueOnce(
      inbox({ mine: [pr({ number: 4, title: 'Back after retry', isMine: true })] }),
    );
    fireEvent.click(screen.getByText('Try again'));

    expect(await screen.findByText('Back after retry')).toBeTruthy();
  });

  test('a linked issue row names the task tracking it', async () => {
    vi.mocked(window.api.github.issues).mockResolvedValue([
      {
        number: 12,
        title: 'Something is broken',
        body: 'details',
        state: 'open',
        author: 'someone',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-02T00:00:00.000Z',
        url: 'https://github.com/o/r/issues/12',
        labels: [],
        isMine: false,
        commentCount: 0,
      },
    ]);
    const linked = task({ taskNumber: 7, githubIssueNumber: 12, status: 'in_progress' });
    useProjectStore.setState({ tasks: [linked] });

    render(<PullRequestsPanel projectPath={PROJECT} />);
    fireEvent.click(await screen.findByText('Issues'));

    // The row names the task and is the way into it. A bare number announced
    // that work existed and gave you no way to reach it.
    fireEvent.click(await screen.findByText('T-7'));
    await waitFor(() => {
      expect(activateTask).toHaveBeenCalledWith({ path: PROJECT, name: 'Alpha' }, linked);
    });
  });

  /**
   * A pull request checked out locally and the task holding that checkout are
   * the same work, so the summary offers the way into it rather than only
   * naming it.
   */
  test('a checked-out pull request opens its task from the summary', async () => {
    vi.mocked(window.api.github.inbox).mockResolvedValue(
      inbox({ mine: [pr({ number: 42, title: 'Half landed', isMine: true })] }),
    );
    vi.mocked(window.api.github.pullRequest).mockResolvedValue(detail({ number: 42, isMine: true }));
    const linked = task({ taskNumber: 3, githubPrNumber: 42, status: 'in_review' });
    useProjectStore.setState({ tasks: [linked] });

    render(<PullRequestsPanel projectPath={PROJECT} />);
    fireEvent.click(await screen.findByText('Half landed'));

    expect(await screen.findByText('In Review')).toBeTruthy();
    fireEvent.click(screen.getAllByText('T-3')[0]);
    await waitFor(() => {
      expect(activateTask).toHaveBeenCalledWith({ path: PROJECT, name: 'Alpha' }, linked);
    });
  });

  test('an unlinked issue offers to create a task', async () => {
    vi.mocked(window.api.github.issues).mockResolvedValue([
      {
        number: 13,
        title: 'Needs doing',
        body: '',
        state: 'open',
        author: 'someone',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-02T00:00:00.000Z',
        url: 'https://github.com/o/r/issues/13',
        labels: [],
        isMine: false,
        commentCount: 0,
      },
    ]);
    vi.mocked(window.api.github.taskFromIssue).mockResolvedValue({ success: true, taskNumber: 9 });

    render(<PullRequestsPanel projectPath={PROJECT} />);
    fireEvent.click(await screen.findByText('Issues'));
    fireEvent.click(await screen.findByText('Create task'));

    await waitFor(() => {
      expect(window.api.github.taskFromIssue).toHaveBeenCalledWith(PROJECT, 13);
    });
  });

  /**
   * The interior used to be three tabs, which put merge on one of them and
   * submit-review on another, so finishing the diff and deciding to land it
   * meant navigating. One document means every part is present at once and the
   * action bar is never somewhere the reader is not.
   */
  test('the panes switch and the actions stay in the chrome', async () => {
    vi.mocked(window.api.github.inbox).mockResolvedValue(
      inbox({ needsReview: [pr({ number: 5, title: 'Please look', reviewRequested: true })] }),
    );
    vi.mocked(window.api.github.pullRequest).mockResolvedValue(detail());

    render(<PullRequestsPanel projectPath={PROJECT} />);
    fireEvent.click(await screen.findByText('Please look'));

    // Lands on the summary: what the change claims to be, before the diff.
    for (const pane of ['Summary', 'Timeline', 'Code']) {
      expect(await screen.findByText(pane)).toBeTruthy();
    }
    expect(await screen.findByText('why this change exists')).toBeTruthy();
    expect(screen.getByText('Ready for review')).toBeTruthy();

    // The list stays put behind it, so the queue is never lost.
    expect(screen.getByText('Please look')).toBeTruthy();

    // Both terminal actions sit in the chrome, reachable from every pane.
    expect(screen.getByText('Review')).toBeTruthy();
    expect(screen.getByText('Merge')).toBeTruthy();

    // The verdicts live in the review menu rather than as three loud buttons.
    fireEvent.click(screen.getByText('Review'));
    expect(screen.getByText('Request changes')).toBeTruthy();
    fireEvent.click(screen.getByText('Approve'));
    await waitFor(() => {
      expect(window.api.github.submitReview).toHaveBeenCalledWith(PROJECT, 5, 'APPROVE', '');
    });
  });

  /**
   * Regression: the summary's Comments section counted the timeline's comments
   * and then rendered only the composer, so posting one bumped the count and
   * showed nothing. A section that counts entries must render those entries.
   */
  test('the comments section shows the comments it counts', async () => {
    vi.mocked(window.api.github.inbox).mockResolvedValue(
      inbox({ needsReview: [pr({ number: 5, title: 'Please look' })] }),
    );
    vi.mocked(window.api.github.pullRequest).mockResolvedValue(
      detail({
        timeline: [
          {
            id: 'c1',
            kind: 'comment',
            author: 'someone',
            body: 'this needs a second look',
            createdAt: '2026-07-02T00:00:00.000Z',
          },
          {
            id: 'e1',
            kind: 'event',
            author: 'someone',
            body: '',
            eventType: 'reopened',
            createdAt: '2026-07-02T00:00:00.000Z',
          },
        ],
      }),
    );

    render(<PullRequestsPanel projectPath={PROJECT} />);
    fireEvent.click(await screen.findByText('Please look'));

    expect(await screen.findByText('this needs a second look')).toBeTruthy();
    // One comment, not two: the reopen event is timeline furniture.
    expect(screen.getByText('1 comment')).toBeTruthy();
    expect(screen.queryByText('reopened')).toBeNull();

    // The timeline pane carries both.
    fireEvent.click(screen.getByText('Timeline'));
    expect(await screen.findByText('reopened')).toBeTruthy();
    expect(screen.getByText('this needs a second look')).toBeTruthy();
  });

  test('you cannot approve your own pull request', async () => {
    vi.mocked(window.api.github.inbox).mockResolvedValue(
      inbox({ mine: [pr({ number: 8, title: 'Mine', isMine: true })] }),
    );
    vi.mocked(window.api.github.pullRequest).mockResolvedValue(detail({ number: 8, isMine: true }));

    render(<PullRequestsPanel projectPath={PROJECT} />);
    fireEvent.click(await screen.findByText('Mine'));
    fireEvent.click(await screen.findByText('Review'));

    expect(screen.getByText('Approve').closest('button')?.disabled).toBe(true);
    expect(screen.getByText('Comment').closest('button')?.disabled).toBe(false);
  });

  test('a closed pull request offers no merge', async () => {
    vi.mocked(window.api.github.inbox).mockResolvedValue(
      inbox({ others: [pr({ number: 6, title: 'Landed already', state: 'merged' })] }),
    );
    vi.mocked(window.api.github.pullRequest).mockResolvedValue(detail({ number: 6, state: 'merged' }));

    render(<PullRequestsPanel projectPath={PROJECT} />);
    fireEvent.click(await screen.findByText('Landed already'));

    expect(await screen.findByText('Review')).toBeTruthy();
    expect(screen.queryByText('Merge')).toBeNull();
  });

  test('surfaces why the panel is empty instead of rendering blank', async () => {
    vi.mocked(window.api.github.availability).mockResolvedValue({
      available: false,
      reason: 'gh-unauthenticated',
      message: 'The GitHub CLI is not signed in. Run `gh auth login` in a terminal, then refresh.',
    });

    render(<PullRequestsPanel projectPath={PROJECT} />);

    expect(await screen.findByText(/not signed in/)).toBeTruthy();
    expect(window.api.github.inbox).not.toHaveBeenCalled();
  });
});
