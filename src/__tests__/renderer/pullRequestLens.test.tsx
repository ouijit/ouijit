import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

import { PullRequestsPanel } from '../../components/github/PullRequestsPanel';
import { useAppStore } from '../../stores/appStore';
import { useGithubStore } from '../../stores/githubStore';
import { useProjectStore } from '../../stores/projectStore';
import { _resetLensRunsForTesting } from '../../components/diff/useLensSession';
import { pr, inbox, detail } from './githubFixtures';

vi.mock('electron-log/renderer', () => ({
  default: { scope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const PROJECT = '/work/alpha';

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
    // A run in flight outlives the pane it started in, which is the point of
    // it — and would otherwise outlive the test that started it too.
    _resetLensRunsForTesting();
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
    vi.mocked(window.api.github.lens).mockResolvedValue(null);
    vi.mocked(window.api.github.pullRequestFiles).mockResolvedValue({ files: [], fromGit: false });
    vi.mocked(window.api.lens.list).mockResolvedValue([]);
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
      lensName: 'Narrative',
      stale: false,
      groups: [{ title: 'Transport', summary: 'How it talks', slices: [{ path: 'src/api.ts' }] }],
    });
    vi.mocked(window.api.lens.list).mockResolvedValue([{ name: 'Narrative', instruction: 'group by story' }]);

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
    vi.mocked(window.api.github.lens).mockResolvedValue(null);
    vi.mocked(window.api.lens.list).mockResolvedValue([
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
      lensName: null,
      stale: false,
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
   * The rail is a way through the document, not a filter on it. Leaving the
   * clicked file alone on screen makes the one before it and the one after it
   * unreachable without going back to the list.
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
      lensName: 'Narrative',
      stale: false,
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
    vi.mocked(window.api.github.lens).mockResolvedValue(null);

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
   * Escape belongs to the innermost thing that is open. A menu opened inside
   * the dialog is portaled out of it, so nothing but the handlers decides
   * this — and the dialog was listening first.
   */
  test('escape closes a menu inside the lens dialog, not the dialog', async () => {
    vi.mocked(window.api.github.inbox).mockResolvedValue(
      inbox({ needsReview: [pr({ number: 5, title: 'Please look' })] }),
    );
    vi.mocked(window.api.github.pullRequest).mockResolvedValue(detail());

    render(<PullRequestsPanel projectPath={PROJECT} />);
    fireEvent.click(await screen.findByText('Please look'));
    fireEvent.click(await screen.findByText('Code'));
    await openPicker();
    pick('Add a lens…');

    fireEvent.click(await screen.findByRole('button', { name: /Automatic/ }));
    expect(await screen.findByRole('menuitem', { name: /^Codex/ })).toBeTruthy();

    fireEvent.keyDown(document.body, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('menuitem', { name: /^Codex/ })).toBeNull());
    expect(screen.getByTestId('dialog-overlay').dataset.visible).toBe('true');
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
    vi.mocked(window.api.github.lens).mockResolvedValue(null);
    vi.mocked(window.api.lens.list).mockResolvedValue([{ name: 'Narrative', instruction: 'group by story' }]);
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
   * rename that leaves the record behind turns what is on screen into something
   * the project does not have, listed a second time under its former name.
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
      lensName: 'Narrative',
      stale: false,
      groups: [{ title: 'Transport', slices: [{ path: 'src/api.ts' }] }],
    });
    vi.mocked(window.api.lens.list).mockResolvedValue([{ name: 'Narrative', instruction: 'group by story' }]);

    // Main renames the lens and the groupings it wrote in the one call, then
    // says so. Nothing in the renderer patches a name it is holding.
    let renamed: ((payload: { projectPath: string; from: string; to: string }) => void) | null = null;
    vi.mocked(window.api.lens.onRenamed).mockImplementation((cb) => {
      renamed = cb;
      return () => {};
    });
    vi.mocked(window.api.lens.save).mockImplementation(async (project, name, instruction, previousName) => {
      vi.mocked(window.api.lens.list).mockResolvedValue([{ name, instruction }]);
      vi.mocked(window.api.github.lens).mockResolvedValue({
        lensName: name,
        stale: false,
        groups: [{ title: 'Transport', slices: [{ path: 'src/api.ts' }] }],
      });
      if (previousName) renamed?.({ projectPath: project, from: previousName, to: name });
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
      expect(window.api.lens.save).toHaveBeenCalledWith(PROJECT, 'Narrative v2', 'group by story', 'Narrative'),
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
    vi.mocked(window.api.github.lens).mockResolvedValue(null);
    vi.mocked(window.api.lens.list).mockResolvedValue([{ name: 'Narrative', instruction: 'group by story' }]);

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
   * The call that starts a run is the one that knows it finished, so it clears
   * "writing" itself. Leaving that to the push from the REST router strands
   * this path, which does not go through it: the lens lands on disk and the
   * rail spins for ever.
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
    vi.mocked(window.api.github.lens).mockResolvedValue(null);
    vi.mocked(window.api.lens.list).mockResolvedValue([{ name: 'Narrative', instruction: 'group by story' }]);
    vi.mocked(window.api.github.runLens).mockImplementation(async () => {
      vi.mocked(window.api.github.lens).mockResolvedValue({
        lensName: 'Narrative',
        stale: false,
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
    vi.mocked(window.api.github.lens).mockResolvedValue(null);
    vi.mocked(window.api.lens.list).mockResolvedValue([{ name: 'Narrative', instruction: 'group by story' }]);
    vi.mocked(window.api.github.runLens).mockResolvedValue({ success: false, error: 'claude is not on PATH' });

    render(<PullRequestsPanel projectPath={PROJECT} />);
    fireEvent.click(await screen.findByText('Please look'));
    fireEvent.click(await screen.findByText('Code'));
    await openPicker();
    pick('Narrative');

    await waitFor(() => expect(screen.queryByText(/Writing/)).toBeNull());
    expect(useProjectStore.getState().toasts.some((t) => t.message.includes('not on PATH'))).toBe(true);
  });

  /**
   * The run happens in main, so leaving the pull request is not a reason to
   * forget it. Held in component state it dies with the pane, and reopening
   * shows no sign of the agent still working.
   */
  test('the run survives closing the pull request', async () => {
    vi.mocked(window.api.github.inbox).mockResolvedValue(
      inbox({ needsReview: [pr({ number: 5, title: 'Please look' })] }),
    );
    vi.mocked(window.api.github.pullRequest).mockResolvedValue(detail());
    vi.mocked(window.api.github.lens).mockResolvedValue(null);
    vi.mocked(window.api.lens.list).mockResolvedValue([{ name: 'Narrative', instruction: 'group by story' }]);
    vi.mocked(window.api.github.runLens).mockReturnValue(new Promise(() => {}));

    render(<PullRequestsPanel projectPath={PROJECT} />);
    fireEvent.click(await screen.findByText('Please look'));
    fireEvent.click(await screen.findByText('Code'));
    await openPicker();
    pick('Narrative');

    expect(await screen.findByText('Writing Narrative…')).toBeTruthy();

    useGithubStore.getState().closeDetail();
    await waitFor(() => expect(screen.queryByText('Writing Narrative…')).toBeNull());

    // Reopened, it is still going: the run belongs to the pull request, not to
    // the pane that happened to be showing it.
    fireEvent.click(await screen.findByText('Please look'));
    fireEvent.click(await screen.findByText('Code'));
    expect(await screen.findByText('Writing Narrative…')).toBeTruthy();
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
    vi.mocked(window.api.github.lens).mockResolvedValue(null);

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
      lensName: null,
      stale: false,
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
    vi.mocked(window.api.github.lens).mockResolvedValue({ lensName: null, groups: null, stale: true });

    render(<PullRequestsPanel projectPath={PROJECT} />);
    fireEvent.click(await screen.findByText('Please look'));
    fireEvent.click(await screen.findByText('Code'));

    expect(await screen.findByTitle('How to read this change')).toBeTruthy();
    expect(screen.getByText('All files')).toBeTruthy();
  });

  /**
   * An agent run that has gone stale is still a thing the reader paid for.
   * Dropping to the file list without a word is how they lose it without ever
   * learning it happened — so the lens that wrote it says it is out of date,
   * and pressing it writes it again.
   */
  test('a stale lens says so and offers to be written again', async () => {
    vi.mocked(window.api.github.inbox).mockResolvedValue(
      inbox({ needsReview: [pr({ number: 5, title: 'Please look' })] }),
    );
    vi.mocked(window.api.github.pullRequest).mockResolvedValue(detail());
    vi.mocked(window.api.github.lens).mockResolvedValue({ lensName: 'Narrative', groups: null, stale: true });
    vi.mocked(window.api.lens.list).mockResolvedValue([{ name: 'Narrative', instruction: 'group by story' }]);
    vi.mocked(window.api.github.runLens).mockReturnValue(new Promise(() => {}));

    render(<PullRequestsPanel projectPath={PROJECT} />);
    fireEvent.click(await screen.findByText('Please look'));
    fireEvent.click(await screen.findByText('Code'));

    // Said on the control itself, for a reader who never opens it.
    expect(
      await screen.findByTitle('How to read this change — “Narrative” was written for earlier commits'),
    ).toBeTruthy();

    await openPicker();
    expect(screen.getByRole('menuitem', { name: 'Narrativeout of date' })).toBeTruthy();

    pick(/^Narrative/);
    await waitFor(() => expect(window.api.github.runLens).toHaveBeenCalledWith(PROJECT, 5, 'Narrative'));
  });

  /**
   * A lens posted over the CLI cannot be written again from here, and one the
   * project has since renamed or deleted has no row to carry the notice. A
   * notice with no cure is a nag, so nothing is said.
   */
  test('a stale lens the project cannot run again is left unsaid', async () => {
    vi.mocked(window.api.github.inbox).mockResolvedValue(
      inbox({ needsReview: [pr({ number: 5, title: 'Please look' })] }),
    );
    vi.mocked(window.api.github.pullRequest).mockResolvedValue(detail());
    vi.mocked(window.api.github.lens).mockResolvedValue({ lensName: 'Gone', groups: null, stale: true });
    vi.mocked(window.api.lens.list).mockResolvedValue([{ name: 'Narrative', instruction: 'group by story' }]);

    render(<PullRequestsPanel projectPath={PROJECT} />);
    fireEvent.click(await screen.findByText('Please look'));
    fireEvent.click(await screen.findByText('Code'));

    expect(await screen.findByTitle('How to read this change')).toBeTruthy();
    await openPicker();
    expect(screen.queryByText('out of date')).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Narrative' })).toBeTruthy();
  });
});
