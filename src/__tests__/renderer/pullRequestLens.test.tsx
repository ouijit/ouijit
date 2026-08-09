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
    vi.mocked(window.api.github.onLensChanged).mockReturnValue(() => {});
    vi.mocked(window.api.github.drafts).mockResolvedValue([]);
    vi.mocked(window.api.github.listPrCommands).mockResolvedValue([]);
    vi.mocked(window.api.github.lens).mockResolvedValue({ groups: null });
    vi.mocked(window.api.github.pullRequestFiles).mockResolvedValue({ files: [], fromGit: false });
    vi.mocked(window.api.github.listLenses).mockResolvedValue([]);
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
    expect(await screen.findByText('Lens')).toBeTruthy();
    expect((await screen.findAllByText('Transport')).length).toBeGreaterThan(0);

    // The file the lens never mentioned is still in the diff, not hidden.
    expect(screen.getAllByText('Not in this lens').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText('All files'));
    expect(screen.queryByText('Transport')).toBeNull();
  });

  /**
   * With none written, the rail is where the way to get one lives — beside
   * where it would appear, not behind the settings panel.
   */
  test('with no lens the rail opens the lenses', async () => {
    vi.mocked(window.api.github.inbox).mockResolvedValue(
      inbox({ needsReview: [pr({ number: 5, title: 'Please look' })] }),
    );
    vi.mocked(window.api.github.pullRequest).mockResolvedValue(detail());
    vi.mocked(window.api.github.lens).mockResolvedValue({ groups: null });

    render(<PullRequestsPanel projectPath={PROJECT} />);
    fireEvent.click(await screen.findByText('Please look'));
    fireEvent.click(await screen.findByText('Code'));

    expect(await screen.findByText('All files')).toBeTruthy();
    expect(screen.queryByText('Lens')).toBeNull();

    // The dialog opens here rather than sending the reader to settings and
    // leaving them to find their way back.
    fireEvent.click(await screen.findByText('Lenses…'));
    expect(await screen.findByText(/No lenses yet/)).toBeTruthy();
    expect(useProjectStore.getState().activePanel).not.toBe('settings');
  });

  test('a lens in the dialog can be written against the pull request', async () => {
    vi.mocked(window.api.github.inbox).mockResolvedValue(
      inbox({ needsReview: [pr({ number: 5, title: 'Please look' })] }),
    );
    vi.mocked(window.api.github.pullRequest).mockResolvedValue(detail());
    vi.mocked(window.api.github.lens).mockResolvedValue({ groups: null });
    vi.mocked(window.api.github.listLenses).mockResolvedValue([{ name: 'Narrative', command: 'claude "group this"' }]);

    render(<PullRequestsPanel projectPath={PROJECT} />);
    fireEvent.click(await screen.findByText('Please look'));
    fireEvent.click(await screen.findByText('Code'));

    fireEvent.click(await screen.findByText('Lenses…'));

    // The row is the lens: pressing it reads the pull request through it.
    // There is no verb to learn and no second button to aim at.
    fireEvent.click(await screen.findByText('Narrative'));
    await waitFor(() => expect(screen.queryByText('Narrative')).toBeNull());
  });

  test('a lens can be edited without running it', async () => {
    vi.mocked(window.api.github.inbox).mockResolvedValue(
      inbox({ needsReview: [pr({ number: 5, title: 'Please look' })] }),
    );
    vi.mocked(window.api.github.pullRequest).mockResolvedValue(detail());
    vi.mocked(window.api.github.lens).mockResolvedValue({ groups: null });
    vi.mocked(window.api.github.listLenses).mockResolvedValue([{ name: 'Narrative', command: 'claude "group this"' }]);

    render(<PullRequestsPanel projectPath={PROJECT} />);
    fireEvent.click(await screen.findByText('Please look'));
    fireEvent.click(await screen.findByText('Code'));
    fireEvent.click(await screen.findByText('Lenses…'));

    fireEvent.click(await screen.findByLabelText('Edit Narrative'));
    expect(await screen.findByDisplayValue('claude "group this"')).toBeTruthy();
  });

  /**
   * The command runs in a terminal the panel cannot see the end of, so the
   * write is what tells it. Without this the rail says "writing" forever while
   * the lens is already on disk.
   */
  test('a lens written elsewhere arrives without asking', async () => {
    vi.mocked(window.api.github.inbox).mockResolvedValue(
      inbox({ needsReview: [pr({ number: 5, title: 'Please look' })] }),
    );
    vi.mocked(window.api.github.pullRequest).mockResolvedValue(detail({ changedFiles: 1 }));
    vi.mocked(window.api.github.pullRequestFiles).mockResolvedValue({
      files: [{ path: 'src/api.ts', status: 'M', additions: 1, deletions: 1 }],
      fromGit: false,
    });
    vi.mocked(window.api.github.lens).mockResolvedValue({ groups: null });

    let notify: ((payload: { projectPath: string; prNumber: number }) => void) | null = null;
    vi.mocked(window.api.github.onLensChanged).mockImplementation((cb) => {
      notify = cb;
      return () => {};
    });

    render(<PullRequestsPanel projectPath={PROJECT} />);
    fireEvent.click(await screen.findByText('Please look'));
    fireEvent.click(await screen.findByText('Code'));
    expect(await screen.findByText('Lenses…')).toBeTruthy();

    vi.mocked(window.api.github.lens).mockResolvedValue({
      groups: [{ title: 'Transport', slices: [{ path: 'src/api.ts' }] }],
    });
    notify?.({ projectPath: PROJECT, prNumber: 5 });

    expect(await screen.findByText('Lens')).toBeTruthy();
    // One local read for the lens, and nothing else refetched.
    expect(window.api.github.pullRequest).toHaveBeenCalledTimes(1);
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
    expect(screen.queryByText('Lens')).toBeNull();
  });
});
