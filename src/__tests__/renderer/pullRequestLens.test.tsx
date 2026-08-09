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

/** The rail's one control: how this change is being read. */
async function openPicker() {
  fireEvent.click(await screen.findByTitle(/^(How to read|Reading) this change/));
}

/** A row in the open picker — All files and the lenses are the same kind of thing. */
function pick(label: string | RegExp) {
  fireEvent.click(screen.getByRole('menuitem', { name: label }));
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
      name: 'Narrative',
      groups: [{ title: 'Transport', summary: 'How it talks', slices: [{ path: 'src/api.ts' }] }],
    });
    vi.mocked(window.api.github.listLenses).mockResolvedValue([{ name: 'Narrative', instruction: 'group by story' }]);

    render(<PullRequestsPanel projectPath={PROJECT} />);
    fireEvent.click(await screen.findByText('Please look'));
    fireEvent.click(await screen.findByText('Code'));

    // Read for this head, and applied without asking — the control says which
    // lens is doing the reading, not merely that one is.
    await waitFor(() => expect(window.api.github.lens).toHaveBeenCalledWith(PROJECT, 5, 'bbb'));
    expect(await screen.findByTitle('Reading this change through “Narrative”')).toBeTruthy();
    expect((await screen.findAllByText('Transport')).length).toBeGreaterThan(0);

    // The file the lens never mentioned is still in the diff, not hidden.
    expect(screen.getAllByText('Not in this lens').length).toBeGreaterThan(0);

    await openPicker();
    pick(/^All files/);
    expect(screen.queryByText('Transport')).toBeNull();

    // And back again from the same list, without writing it a second time.
    await openPicker();
    pick(/^Narrative/);
    expect((await screen.findAllByText('Transport')).length).toBeGreaterThan(0);
    expect(window.api.github.runLens).not.toHaveBeenCalled();
  });

  /**
   * All files is a lens like the rest — the one that groups nothing — so it is
   * a row in the same list rather than a control of its own.
   */
  test('the picker offers All files and the project lenses together', async () => {
    vi.mocked(window.api.github.inbox).mockResolvedValue(
      inbox({ needsReview: [pr({ number: 5, title: 'Please look' })] }),
    );
    vi.mocked(window.api.github.pullRequest).mockResolvedValue(detail({ changedFiles: 3 }));
    vi.mocked(window.api.github.lens).mockResolvedValue({ groups: null });
    vi.mocked(window.api.github.listLenses).mockResolvedValue([
      { name: 'Narrative', instruction: 'group by story' },
      { name: 'What the tests miss', instruction: 'group by risk' },
    ]);

    render(<PullRequestsPanel projectPath={PROJECT} />);
    fireEvent.click(await screen.findByText('Please look'));
    fireEvent.click(await screen.findByText('Code'));
    await openPicker();

    const rows = screen.getAllByRole('menuitem').map((row) => row.textContent);
    expect(rows[0]).toMatch(/^All files/);
    expect(rows[1]).toBe('Narrative');
    expect(rows[2]).toBe('What the tests miss');
    expect(rows[3]).toBe('Manage lenses…');
  });

  /**
   * A grouping that hides the directories has answered the easy half of the
   * question. Which layer a part of the change touches is most of what tells a
   * reviewer what kind of change they are looking at.
   */
  test('a group keeps the directories its files sit in', async () => {
    vi.mocked(window.api.github.inbox).mockResolvedValue(
      inbox({ needsReview: [pr({ number: 5, title: 'Please look' })] }),
    );
    vi.mocked(window.api.github.pullRequest).mockResolvedValue(detail({ changedFiles: 2 }));
    vi.mocked(window.api.github.pullRequestFiles).mockResolvedValue({
      files: [
        { path: 'src/github/api.ts', status: 'M', additions: 1, deletions: 1 },
        { path: 'src/github/client.ts', status: 'M', additions: 1, deletions: 1 },
      ],
      fromGit: false,
    });
    vi.mocked(window.api.github.lens).mockResolvedValue({
      groups: [
        {
          title: 'Talking to GitHub',
          slices: [{ path: 'src/github/api.ts' }, { path: 'src/github/client.ts' }],
        },
      ],
    });

    render(<PullRequestsPanel projectPath={PROJECT} />);
    fireEvent.click(await screen.findByText('Please look'));
    fireEvent.click(await screen.findByText('Code'));

    // The shared directory is collapsed to one node above the two files, the
    // same as the flat tree does it.
    expect(await screen.findByText('src/github')).toBeTruthy();
    expect(screen.getAllByText('api.ts').length).toBeGreaterThan(0);

    // And the title is set as the lens wrote it, not shouted at the reader —
    // in the rail and in the document, which both show it.
    const headings = screen.getAllByText('Talking to GitHub');
    expect(headings.length).toBeGreaterThan(0);
    for (const heading of headings) expect(heading.className).not.toContain('uppercase');
  });

  /**
   * The rail is a way through the document, not a filter on it. Clicking a file
   * used to leave that file alone on screen, which made the one before it and
   * the one after it unreachable without going back to the list.
   */
  test('clicking a file in the rail takes you to it, leaving the rest in place', async () => {
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

    render(<PullRequestsPanel projectPath={PROJECT} />);
    fireEvent.click(await screen.findByText('Please look'));
    fireEvent.click(await screen.findByText('Code'));

    await waitFor(() => expect(screen.getAllByText('api.ts').length).toBeGreaterThan(0));

    // The document beside the rail — the pane the rail scrolls.
    const pane = document.querySelector<HTMLElement>('div.flex-1.min-w-0.overflow-y-auto');
    const anchors = () =>
      Array.from(pane?.querySelectorAll<HTMLElement>('[data-path]') ?? [])
        .filter((el) => !el.parentElement?.closest('[data-path]'))
        .map((el) => el.dataset.path);

    // Both files are in the document before the click, and both after it.
    expect(anchors()).toEqual(['src/api.ts', 'src/ui.tsx']);
    fireEvent.click(screen.getAllByText('ui.tsx')[0]);
    expect(anchors()).toEqual(['src/api.ts', 'src/ui.tsx']);

    // And the rail marks the one you were taken to.
    await waitFor(() => expect(useGithubStore.getState().activePath).toBe('src/ui.tsx'));
  });

  /**
   * A part of a change is read and finished with the way a file is, so it folds
   * the way a file does — and on both sides of the seam, since the rail and the
   * document are showing the same part.
   */
  test('a part of the change folds away, and stays folded', async () => {
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
      name: 'Narrative',
      groups: [
        { title: 'Transport', slices: [{ path: 'src/api.ts' }] },
        { title: 'Screens', slices: [{ path: 'src/ui.tsx' }] },
      ],
    });

    render(<PullRequestsPanel projectPath={PROJECT} />);
    fireEvent.click(await screen.findByText('Please look'));
    fireEvent.click(await screen.findByText('Code'));

    expect((await screen.findAllByText('Transport')).length).toBeGreaterThan(0);
    await waitFor(() => expect(document.querySelectorAll('[data-path="src/api.ts"]').length).toBeGreaterThan(0));

    fireEvent.click(screen.getByTitle('Fold Transport away'));

    // Gone from the document and from the rail, while the part it belongs to
    // stays where it was — and the rest of the change is untouched.
    expect(document.querySelectorAll('[data-path="src/api.ts"]').length).toBe(0);
    expect(document.querySelectorAll('[data-path="src/ui.tsx"]').length).toBeGreaterThan(0);
    expect(screen.getByTitle('Transport — click to unfold')).toBeTruthy();

    // Going to read the description is not a decision to unfold it again.
    fireEvent.click(screen.getByText('Summary'));
    fireEvent.click(screen.getByText('Code'));
    expect(await screen.findByTitle('Transport — click to unfold')).toBeTruthy();
    expect(document.querySelectorAll('[data-path="src/api.ts"]').length).toBe(0);

    fireEvent.click(screen.getByTitle('Transport — click to unfold'));
    await waitFor(() => expect(document.querySelectorAll('[data-path="src/api.ts"]').length).toBeGreaterThan(0));
  });

  /**
   * With none written, the way to get one lives in the same list — beside where
   * it would appear, not behind the settings panel.
   */
  test('with no lenses the picker offers to add one', async () => {
    vi.mocked(window.api.github.inbox).mockResolvedValue(
      inbox({ needsReview: [pr({ number: 5, title: 'Please look' })] }),
    );
    vi.mocked(window.api.github.pullRequest).mockResolvedValue(detail());
    vi.mocked(window.api.github.lens).mockResolvedValue({ groups: null });

    render(<PullRequestsPanel projectPath={PROJECT} />);
    fireEvent.click(await screen.findByText('Please look'));
    fireEvent.click(await screen.findByText('Code'));

    expect(await screen.findByTitle('How to read this change')).toBeTruthy();
    await openPicker();

    // The dialog opens here rather than sending the reader to settings and
    // leaving them to find their way back.
    pick('Add a lens…');
    expect(await screen.findByText(/No lenses yet/)).toBeTruthy();
    expect(useProjectStore.getState().activePanel).not.toBe('settings');
  });

  /**
   * The row is the lens: picking one reads the pull request through it. There
   * is no verb to learn, and no dialog between wanting one and having it.
   */
  test('picking a lens writes it against the pull request', async () => {
    vi.mocked(window.api.github.inbox).mockResolvedValue(
      inbox({ needsReview: [pr({ number: 5, title: 'Please look' })] }),
    );
    vi.mocked(window.api.github.pullRequest).mockResolvedValue(detail());
    vi.mocked(window.api.github.lens).mockResolvedValue({ groups: null });
    vi.mocked(window.api.github.listLenses).mockResolvedValue([{ name: 'Narrative', instruction: 'group by story' }]);
    vi.mocked(window.api.github.runLens).mockReturnValue(new Promise(() => {}));

    render(<PullRequestsPanel projectPath={PROJECT} />);
    fireEvent.click(await screen.findByText('Please look'));
    fireEvent.click(await screen.findByText('Code'));
    await openPicker();
    pick('Narrative');

    await waitFor(() => expect(window.api.github.runLens).toHaveBeenCalledWith(PROJECT, 5, 'Narrative'));
    // And says so where the choice was made, rather than somewhere else.
    expect(await screen.findByText('Writing Narrative…')).toBeTruthy();
  });

  /**
   * A lens is keyed by name, and the grouping it wrote records that name. A
   * rename that leaves the record behind turns what is already on screen into
   * something the project no longer has — listed a second time, under the name
   * it used to have.
   */
  test('renaming a lens carries the reading it has already done', async () => {
    vi.mocked(window.api.github.inbox).mockResolvedValue(
      inbox({ needsReview: [pr({ number: 5, title: 'Please look' })] }),
    );
    vi.mocked(window.api.github.pullRequest).mockResolvedValue(detail({ changedFiles: 1 }));
    vi.mocked(window.api.github.pullRequestFiles).mockResolvedValue({
      files: [{ path: 'src/api.ts', status: 'M', additions: 1, deletions: 1 }],
      fromGit: false,
    });
    vi.mocked(window.api.github.lens).mockResolvedValue({
      name: 'Narrative',
      groups: [{ title: 'Transport', slices: [{ path: 'src/api.ts' }] }],
    });
    vi.mocked(window.api.github.listLenses).mockResolvedValue([{ name: 'Narrative', instruction: 'group by story' }]);
    vi.mocked(window.api.github.saveLens).mockImplementation(async (_project, name, instruction) => {
      vi.mocked(window.api.github.listLenses).mockResolvedValue([{ name, instruction }]);
      return { name, instruction };
    });

    render(<PullRequestsPanel projectPath={PROJECT} />);
    fireEvent.click(await screen.findByText('Please look'));
    fireEvent.click(await screen.findByText('Code'));
    await openPicker();
    pick('Manage lenses…');

    fireEvent.click(await screen.findByLabelText('Edit Narrative'));
    fireEvent.change(await screen.findByDisplayValue('Narrative'), { target: { value: 'Narrative v2' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(window.api.github.saveLens).toHaveBeenCalledWith(PROJECT, 'Narrative v2', 'group by story', 'Narrative'),
    );
    // What is on screen is still what it was, under the name just typed.
    expect(await screen.findByTitle('Reading this change through “Narrative v2”')).toBeTruthy();

    fireEvent.click(screen.getByText('Done'));
    await waitFor(() => expect(screen.queryByText('Add a lens')).toBeNull());

    await openPicker();
    const rows = screen.getAllByRole('menuitem').map((row) => row.textContent);
    expect(rows.filter((row) => row?.startsWith('Narrative'))).toEqual(['Narrative v21 parts']);
  });

  test('a lens can be edited without running it', async () => {
    vi.mocked(window.api.github.inbox).mockResolvedValue(
      inbox({ needsReview: [pr({ number: 5, title: 'Please look' })] }),
    );
    vi.mocked(window.api.github.pullRequest).mockResolvedValue(detail());
    vi.mocked(window.api.github.lens).mockResolvedValue({ groups: null });
    vi.mocked(window.api.github.listLenses).mockResolvedValue([{ name: 'Narrative', instruction: 'group by story' }]);

    render(<PullRequestsPanel projectPath={PROJECT} />);
    fireEvent.click(await screen.findByText('Please look'));
    fireEvent.click(await screen.findByText('Code'));
    await openPicker();
    pick('Manage lenses…');

    fireEvent.click(await screen.findByLabelText('Edit Narrative'));
    expect(await screen.findByDisplayValue('group by story')).toBeTruthy();
    expect(window.api.github.runLens).not.toHaveBeenCalled();
  });

  /**
   * Regression: the run saved the lens in main and returned, but the only
   * thing that cleared "writing" was a push emitted from the REST router —
   * which this path does not go through. The lens was on disk and the rail
   * span for ever.
   */
  test('a finished run shows its lens and stops saying it is writing', async () => {
    vi.mocked(window.api.github.inbox).mockResolvedValue(
      inbox({ needsReview: [pr({ number: 5, title: 'Please look' })] }),
    );
    vi.mocked(window.api.github.pullRequest).mockResolvedValue(detail({ changedFiles: 1 }));
    vi.mocked(window.api.github.pullRequestFiles).mockResolvedValue({
      files: [{ path: 'src/api.ts', status: 'M', additions: 1, deletions: 1 }],
      fromGit: false,
    });
    vi.mocked(window.api.github.lens).mockResolvedValue({ groups: null });
    vi.mocked(window.api.github.listLenses).mockResolvedValue([{ name: 'Narrative', instruction: 'group by story' }]);
    vi.mocked(window.api.github.runLens).mockImplementation(async () => {
      vi.mocked(window.api.github.lens).mockResolvedValue({
        name: 'Narrative',
        groups: [{ title: 'Transport', slices: [{ path: 'src/api.ts' }] }],
      });
      return { success: true };
    });

    render(<PullRequestsPanel projectPath={PROJECT} />);
    fireEvent.click(await screen.findByText('Please look'));
    fireEvent.click(await screen.findByText('Code'));
    await openPicker();
    pick('Narrative');

    expect(await screen.findByTitle('Reading this change through “Narrative”')).toBeTruthy();
    expect(screen.queryByText(/Writing/)).toBeNull();
    expect(useGithubStore.getState().lensRun).toBeNull();
  });

  /**
   * A run that fails has to stop too. Clearing only on success is the same
   * bug wearing a different hat.
   */
  test('a failed run says so and stops spinning', async () => {
    vi.mocked(window.api.github.inbox).mockResolvedValue(
      inbox({ needsReview: [pr({ number: 5, title: 'Please look' })] }),
    );
    vi.mocked(window.api.github.pullRequest).mockResolvedValue(detail());
    vi.mocked(window.api.github.lens).mockResolvedValue({ groups: null });
    vi.mocked(window.api.github.listLenses).mockResolvedValue([{ name: 'Narrative', instruction: 'group by story' }]);
    vi.mocked(window.api.github.runLens).mockResolvedValue({ success: false, error: 'claude is not on PATH' });

    render(<PullRequestsPanel projectPath={PROJECT} />);
    fireEvent.click(await screen.findByText('Please look'));
    fireEvent.click(await screen.findByText('Code'));
    await openPicker();
    pick('Narrative');

    await waitFor(() => expect(useGithubStore.getState().lensRun).toBeNull());
    expect(useProjectStore.getState().toasts.some((t) => t.message.includes('not on PATH'))).toBe(true);
  });

  /**
   * The run happens in main, so leaving the pull request is not a reason to
   * forget it — the rail used to hold it in component state and lose it.
   */
  test('the run survives closing the pull request', async () => {
    vi.mocked(window.api.github.inbox).mockResolvedValue(
      inbox({ needsReview: [pr({ number: 5, title: 'Please look' })] }),
    );
    vi.mocked(window.api.github.pullRequest).mockResolvedValue(detail());
    vi.mocked(window.api.github.lens).mockResolvedValue({ groups: null });
    vi.mocked(window.api.github.listLenses).mockResolvedValue([{ name: 'Narrative', instruction: 'group by story' }]);
    vi.mocked(window.api.github.runLens).mockReturnValue(new Promise(() => {}));

    render(<PullRequestsPanel projectPath={PROJECT} />);
    fireEvent.click(await screen.findByText('Please look'));
    fireEvent.click(await screen.findByText('Code'));
    await openPicker();
    pick('Narrative');

    await waitFor(() => expect(useGithubStore.getState().lensRun).toEqual({ prNumber: 5, name: 'Narrative' }));

    useGithubStore.getState().closeDetail();
    expect(useGithubStore.getState().lensRun).toEqual({ prNumber: 5, name: 'Narrative' });
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
    expect(await screen.findByTitle('How to read this change')).toBeTruthy();

    // Written by an agent over the CLI: no lens of the project's produced it,
    // so it is named for what it is rather than borrowing one of their names.
    vi.mocked(window.api.github.lens).mockResolvedValue({
      groups: [{ title: 'Transport', slices: [{ path: 'src/api.ts' }] }],
    });
    notify?.({ projectPath: PROJECT, prNumber: 5 });

    expect(await screen.findByTitle('Reading this change through a lens written for it')).toBeTruthy();
    expect(screen.getByText('Lens')).toBeTruthy();
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

    expect(await screen.findByTitle('How to read this change')).toBeTruthy();
    expect(screen.getByText('All files')).toBeTruthy();
  });
});
