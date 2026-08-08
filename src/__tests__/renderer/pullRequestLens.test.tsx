import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

vi.mock('electron-log/renderer', () => ({
  default: { scope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { PullRequestsPanel } from '../../components/github/PullRequestsPanel';
import { useAppStore } from '../../stores/appStore';
import { useGithubStore } from '../../stores/githubStore';
import { useProjectStore } from '../../stores/projectStore';
import type { PullRequestDetail, PullRequestSummary } from '../../types';
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
  return { viewer: 'me', needsReview: [], mine: [], others: [], draftCounts: {}, linkedTasks: {}, ...over };
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

/**
 * The Code pane, read through a lens.
 *
 * Their own file rather than alongside the rest of the panel: these mount the
 * whole panel and drive it into the code pane, and sharing a file with twenty
 * other renders of the same component made which tree a query matched depend on
 * what ran before it.
 */
describe('PullRequestsPanel — lens', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    useGithubStore.getState().reset();
    useGithubStore.setState({ projectPath: null });
    useProjectStore.setState({ tasks: [], toasts: [] });
    useAppStore.setState({ activeProjectData: { path: PROJECT, name: 'Alpha' } });
    vi.mocked(window.api.github.availability).mockResolvedValue({
      available: true,
      identity: { host: 'github.com', owner: 'o', repo: 'r' },
    });
    vi.mocked(window.api.github.inbox).mockResolvedValue(inbox());
    vi.mocked(window.api.github.issues).mockResolvedValue([]);
    vi.mocked(window.api.github.onDraftsChanged).mockReturnValue(() => {});
    vi.mocked(window.api.github.drafts).mockResolvedValue([]);
    vi.mocked(window.api.github.listPrCommands).mockResolvedValue([]);
    vi.mocked(window.api.github.lens).mockResolvedValue({ groups: null });
    vi.mocked(window.api.github.pullRequestFiles).mockResolvedValue({ files: [], fromGit: false });
  });

  /**
   * A lens is written for one change by something that has read it, so the
   * reader gets it as soon as it exists — the alternative is hiding the result
   * of an agent run behind a control they would have to know to press.
   */
  test('a lens on file groups the diff, and All files goes back', async () => {
    vi.mocked(window.api.github.inbox).mockResolvedValue(
      inbox({ needsReview: [pr({ number: 5, title: 'Please look' })] }),
    );
    vi.mocked(window.api.github.pullRequest).mockResolvedValue(detail({ changedFiles: 2 }));
    vi.mocked(window.api.github.pullRequestFiles).mockResolvedValue({
      files: [
        { path: 'src/api.ts', status: 'M', additions: 1, deletions: 1 },
        { path: 'src/ui.tsx', status: 'M', additions: 1, deletions: 1 },
      ],
      fromGit: false,
    });
    vi.mocked(window.api.github.lens).mockResolvedValue({
      groups: [{ title: 'Transport', summary: 'How it talks', slices: [{ path: 'src/api.ts' }] }],
    });

    render(<PullRequestsPanel projectPath={PROJECT} />);
    fireEvent.click(await screen.findByText('Please look'));
    fireEvent.click(await screen.findByText('Code'));

    // Read for this head, and applied without asking.
    await waitFor(() => expect(window.api.github.lens).toHaveBeenCalledWith(PROJECT, 5, 'bbb'));
    expect(await screen.findByText('Read as a story')).toBeTruthy();
    expect((await screen.findAllByText('Transport')).length).toBeGreaterThan(0);

    // The file the lens never mentioned is still in the diff, not hidden.
    expect(screen.getAllByText('Not in this lens').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText('All files'));
    expect(screen.queryByText('Transport')).toBeNull();
  });

  /**
   * With none written the pane still says so, and Run is still there to write
   * one. Gating both on a lens already existing is how this shipped invisible.
   */
  test('with no lens the pane says so, and Run leads to setting one up', async () => {
    vi.mocked(window.api.github.inbox).mockResolvedValue(
      inbox({ needsReview: [pr({ number: 5, title: 'Please look' })] }),
    );
    vi.mocked(window.api.github.pullRequest).mockResolvedValue(detail());
    vi.mocked(window.api.github.lens).mockResolvedValue({ groups: null });

    render(<PullRequestsPanel projectPath={PROJECT} />);
    fireEvent.click(await screen.findByText('Please look'));
    fireEvent.click(await screen.findByText('Code'));

    expect(await screen.findByText('All files')).toBeTruthy();
    expect(screen.queryByText('Read as a story')).toBeNull();
    expect(screen.getByText('No reading order yet')).toBeTruthy();

    // Nothing configured, so Run offers the way to configure something rather
    // than not being there at all.
    fireEvent.click(screen.getByText('Run'));
    fireEvent.click(await screen.findByText('Set up a review command…'));
    expect(useProjectStore.getState().activePanel).toBe('settings');
  });

  /**
   * A lens points at specific hunks. After a force-push those hunks are gone,
   * so the service reports it as describing another head and the reader gets
   * the flat list rather than a confident description of code that moved.
   */
  test('a lens for an older head is not applied', async () => {
    vi.mocked(window.api.github.inbox).mockResolvedValue(
      inbox({ needsReview: [pr({ number: 5, title: 'Please look' })] }),
    );
    vi.mocked(window.api.github.pullRequest).mockResolvedValue(detail());
    vi.mocked(window.api.github.lens).mockResolvedValue({ groups: null, staleFor: 'older-sha' });

    render(<PullRequestsPanel projectPath={PROJECT} />);
    fireEvent.click(await screen.findByText('Please look'));
    fireEvent.click(await screen.findByText('Code'));

    expect(await screen.findByText('All files')).toBeTruthy();
    expect(screen.queryByText('Read as a story')).toBeNull();
  });
});
