import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

vi.mock('electron-log/renderer', () => ({
  default: { scope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { PullRequestsPanel } from '../../components/github/PullRequestsPanel';
import { useGithubStore } from '../../stores/githubStore';
import { useProjectStore } from '../../stores/projectStore';
import type { PullRequestSummary, TaskWithWorkspace } from '../../types';
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

  test('renders the three inbox groups, and only those with rows', async () => {
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
    expect(screen.getByText('Yours')).toBeTruthy();
    // No PRs landed in the third bucket, so its header must not render.
    expect(screen.queryByText('Everything else')).toBeNull();
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
