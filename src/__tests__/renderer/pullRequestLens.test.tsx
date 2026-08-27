import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react';

import { PullRequestsPanel } from '../../components/github/PullRequestsPanel';
import { useAppStore } from '../../stores/appStore';
import { useGithubStore } from '../../stores/githubStore';
import { useProjectStore } from '../../stores/projectStore';
import { _resetLensRunsForTesting } from '../../components/diff/useLensSession';
import { NARRATIVE, hunk, lensOnFile } from '../lensFixtures';
import { pr, inbox, detail, changed } from './githubFixtures';
import type { PullRequestFile } from '../../github/types';
import type { StoredLens } from '../../lens/readLens';
import type { LensSummary } from '../../lens/config';

vi.mock('electron-log/renderer', () => ({
  default: { scope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const PROJECT = '/work/alpha';

/**
 * One pull request's Code pane, open and ready to read. `changedFiles` is
 * separate from `files` because the picker reports GitHub's count, which a
 * truncated file list does not match.
 */
async function openCodePane(
  set: {
    files?: PullRequestFile[];
    lens?: StoredLens | null;
    lenses?: LensSummary[];
    changedFiles?: number;
    headSha?: string;
  } = {},
): Promise<void> {
  vi.mocked(window.api.github.inbox).mockResolvedValue(
    inbox({ needsReview: [pr({ number: 5, title: 'Please look' })] }),
  );
  vi.mocked(window.api.github.pullRequest).mockResolvedValue(
    detail({
      changedFiles: set.changedFiles ?? set.files?.length ?? 1,
      ...(set.headSha ? { headSha: set.headSha } : {}),
    }),
  );
  if (set.files) vi.mocked(window.api.github.pullRequestFiles).mockResolvedValue({ files: set.files, fromGit: false });
  if (set.lens !== undefined) vi.mocked(window.api.github.lens).mockResolvedValue(set.lens);
  if (set.lenses) vi.mocked(window.api.lens.list).mockResolvedValue(set.lenses);

  render(<PullRequestsPanel projectPath={PROJECT} />);
  fireEvent.click(await screen.findByText('Please look'));
  fireEvent.click(await screen.findByText('Code'));
}

/** The rail's one control: how this change is being read. */
async function openPicker() {
  fireEvent.click(await screen.findByTitle(/^(How to read|Reading) this change/));
}

/** A row in the open picker. All files is one of them. */
function pick(label: string | RegExp) {
  fireEvent.click(screen.getByRole('menuitem', { name: label }));
}

/**
 * Their own file rather than alongside the rest of the panel: these mount the
 * whole panel and drive it into the code pane, and sharing a file with twenty
 * other renders made which tree a query matched depend on what ran before it.
 */
describe('PullRequestsPanel — lens', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    // A run in flight outlives the pane it started in, and would otherwise
    // outlive the test that started it too.
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

  test('a lens on file groups the diff, and All files goes back', async () => {
    await openCodePane({
      files: [changed('src/api.ts'), changed('src/ui.tsx')],
      lens: lensOnFile([{ title: 'Transport', summary: 'How it talks', slices: [{ path: 'src/api.ts' }] }], {
        lensId: NARRATIVE.id,
        lensName: NARRATIVE.name,
      }),
      lenses: [NARRATIVE],
    });

    await waitFor(() => expect(window.api.github.lens).toHaveBeenCalledWith(PROJECT, 5, 'bbb'));
    expect(await screen.findByTitle('Reading this change through “Narrative”')).toBeTruthy();
    expect((await screen.findAllByText('Transport')).length).toBeGreaterThan(0);

    // The file the lens never mentioned is still in the diff, not hidden.
    expect(screen.getAllByText('Not in this lens').length).toBeGreaterThan(0);

    await openPicker();
    pick(/^All files/);
    expect(screen.queryByText('Transport')).toBeNull();

    await openPicker();
    pick(/^Narrative/);
    expect((await screen.findAllByText('Transport')).length).toBeGreaterThan(0);
    expect(window.api.github.runLens).not.toHaveBeenCalled();
  });

  test('the picker offers All files and the project lenses together', async () => {
    await openCodePane({
      changedFiles: 3,
      lens: null,
      lenses: [NARRATIVE, { id: 'risk', name: 'What the tests miss', instruction: 'group by risk' }],
    });
    await openPicker();

    const rows = screen.getAllByRole('menuitem').map((row) => row.textContent);
    expect(rows[0]).toMatch(/^All files/);
    expect(rows[1]).toBe('Narrative');
    expect(rows[2]).toBe('What the tests miss');
    expect(rows[3]).toBe('Manage lenses…');
  });

  test('a group keeps the directories its files sit in', async () => {
    await openCodePane({
      files: [changed('src/github/api.ts'), changed('src/github/client.ts')],
      lens: lensOnFile([
        { title: 'Talking to GitHub', slices: [{ path: 'src/github/api.ts' }, { path: 'src/github/client.ts' }] },
      ]),
    });

    // Collapsed to one node above the two files, as the flat tree does it.
    expect(await screen.findByText('src/github')).toBeTruthy();
    expect(screen.getAllByText('api.ts').length).toBeGreaterThan(0);

    const headings = screen.getAllByText('Talking to GitHub');
    expect(headings.length).toBeGreaterThan(0);
    for (const heading of headings) expect(heading.className).not.toContain('uppercase');
  });

  test('clicking a file in the rail takes you to it, leaving the rest in place', async () => {
    await openCodePane({ files: [changed('src/api.ts'), changed('src/ui.tsx')] });

    await waitFor(() => expect(screen.getAllByText('api.ts').length).toBeGreaterThan(0));

    // The document beside the rail — the pane the rail scrolls.
    const pane = document.querySelector<HTMLElement>('div.flex-1.min-w-0.overflow-y-auto');
    const anchors = () =>
      Array.from(pane?.querySelectorAll<HTMLElement>('[data-path]') ?? [])
        .filter((el) => !el.parentElement?.closest('[data-path]'))
        .map((el) => el.dataset.path);

    expect(anchors()).toEqual(['src/api.ts', 'src/ui.tsx']);
    fireEvent.click(screen.getAllByText('ui.tsx')[0]);
    expect(anchors()).toEqual(['src/api.ts', 'src/ui.tsx']);

    await waitFor(() => expect(useGithubStore.getState().activeSection).toBe('src/ui.tsx'));
  });

  test('a file split across parts is marked read a part at a time', async () => {
    vi.mocked(window.api.github.pullRequestFileDiff).mockResolvedValue({
      path: 'src/api.ts',
      hunks: [hunk(1, 1), hunk(10, 1)],
    });
    await openCodePane({
      headSha: 'head1',
      files: [changed('src/api.ts', { additions: 2, deletions: 0 })],
      lens: lensOnFile([
        { title: 'The contract', slices: [{ path: 'src/api.ts', ranges: [[1, 1]] }] },
        { title: 'What follows', slices: [{ path: 'src/api.ts', ranges: [[10, 10]] }] },
      ]),
    });

    const marks = async () => (await screen.findAllByLabelText('Viewed')).map((m) => m.getAttribute('aria-pressed'));
    await waitFor(async () => expect(await marks()).toHaveLength(2));

    fireEvent.click((await screen.findAllByLabelText('Viewed'))[0]);
    // One part read is not the file read.
    expect(await marks()).toEqual(['true', 'false']);
    expect(window.api.github.setFileViewed).not.toHaveBeenCalled();

    fireEvent.click((await screen.findAllByLabelText('Viewed'))[1]);
    expect(await marks()).toEqual(['true', 'true']);
    expect(window.api.github.setFileViewed).toHaveBeenCalledWith(PROJECT, 5, 'head1', 'src/api.ts', true);

    fireEvent.click((await screen.findAllByLabelText('Viewed'))[1]);
    expect(await marks()).toEqual(['true', 'false']);
    expect(window.api.github.setFileViewed).toHaveBeenLastCalledWith(PROJECT, 5, 'head1', 'src/api.ts', false);
  });

  test('a part of the change folds away, and stays folded', async () => {
    await openCodePane({
      files: [changed('src/api.ts'), changed('src/ui.tsx')],
      lens: lensOnFile(
        [
          { title: 'Transport', slices: [{ path: 'src/api.ts' }] },
          { title: 'Screens', slices: [{ path: 'src/ui.tsx' }] },
        ],
        { lensId: NARRATIVE.id, lensName: NARRATIVE.name },
      ),
    });

    expect((await screen.findAllByText('Transport')).length).toBeGreaterThan(0);
    await waitFor(() => expect(document.querySelectorAll('[data-path="src/api.ts"]').length).toBeGreaterThan(0));

    fireEvent.click(screen.getByTitle('Fold Transport away'));

    // Gone from the document and the rail, while the part it belongs to stays.
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

  test('with no lenses the picker offers to add one', async () => {
    await openCodePane({ lens: null });

    expect(await screen.findByTitle('How to read this change')).toBeTruthy();
    await openPicker();

    pick('Add a lens…');
    expect(await screen.findByText(/No lenses yet/)).toBeTruthy();
    expect(useProjectStore.getState().activePanel).not.toBe('settings');
  });

  test('the picker follows lenses added and deleted elsewhere', async () => {
    let changedList: ((projectPath: string) => void) | null = null;
    vi.mocked(window.api.lens.onListChanged).mockImplementation((cb) => {
      changedList = cb;
      return () => {};
    });
    await openCodePane({ lens: null });

    await openPicker();
    expect(screen.queryByRole('menuitem', { name: 'Narrative' })).toBeNull();

    vi.mocked(window.api.lens.list).mockResolvedValue([NARRATIVE]);
    await act(async () => changedList?.(PROJECT));
    expect(await screen.findByRole('menuitem', { name: 'Narrative' })).toBeTruthy();

    vi.mocked(window.api.lens.list).mockResolvedValue([]);
    await act(async () => changedList?.('/work/beta'));
    expect(screen.getByRole('menuitem', { name: 'Narrative' })).toBeTruthy();

    await act(async () => changedList?.(PROJECT));
    await waitFor(() => expect(screen.queryByRole('menuitem', { name: 'Narrative' })).toBeNull());
  });

  test('a lens made in the dialog reads the change and gets out of the way', async () => {
    vi.mocked(window.api.lens.save).mockImplementation(async (_project, input) => ({ id: 'made', ...input }));
    vi.mocked(window.api.github.runLens).mockReturnValue(new Promise(() => {}));
    await openCodePane({ lens: null });

    await openPicker();
    pick('Add a lens…');

    fireEvent.click(await screen.findByText('Risk first'));
    expect(window.api.lens.save).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue(/what could break in production/)).toBeTruthy();

    fireEvent.click(screen.getByText('Save and run'));
    await waitFor(() =>
      expect(window.api.lens.save).toHaveBeenCalledWith(PROJECT, {
        name: 'Risk first',
        instruction: expect.stringContaining('what could break in production'),
      }),
    );
    await waitFor(() => expect(window.api.github.runLens).toHaveBeenCalledWith(PROJECT, 5, 'made'));
    await waitFor(() => expect(screen.queryByTestId('dialog-overlay')).toBeNull());

    expect(await screen.findByText('Writing Risk first…')).toBeTruthy();
  });

  test('the explanation is behind the info mark, not standing in the body', async () => {
    await openCodePane();
    await openPicker();
    pick('Add a lens…');

    const explained = /group a diff into named parts/i;
    expect(await screen.findByText('No lenses yet.')).toBeTruthy();
    expect(screen.queryByText(explained)).toBeNull();

    // Focused rather than hovered: hover carries an open delay.
    fireEvent.focus(screen.getByLabelText('What a lens is'));
    expect(await screen.findByText(explained)).toBeTruthy();
  });

  test('escape closes a menu inside the lens dialog, not the dialog', async () => {
    await openCodePane();
    await openPicker();
    pick('Add a lens…');

    fireEvent.click(await screen.findByRole('button', { name: /Claude Code/ }));
    expect(await screen.findByRole('menuitem', { name: /^Codex/ })).toBeTruthy();

    fireEvent.keyDown(document.body, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('menuitem', { name: /^Codex/ })).toBeNull());
    expect(screen.getByTestId('dialog-overlay').dataset.visible).toBe('true');
  });

  test('picking a lens writes it against the pull request', async () => {
    vi.mocked(window.api.github.runLens).mockReturnValue(new Promise(() => {}));
    await openCodePane({ lens: null, lenses: [NARRATIVE] });

    await openPicker();
    pick('Narrative');

    await waitFor(() => expect(window.api.github.runLens).toHaveBeenCalledWith(PROJECT, 5, 'narrative'));
    expect(await screen.findByText('Writing Narrative…')).toBeTruthy();
  });

  test('renaming a lens renames the reading it has already done', async () => {
    const listChanged = new Set<(projectPath: string) => void>();
    vi.mocked(window.api.lens.onListChanged).mockImplementation((cb) => {
      listChanged.add(cb);
      return () => listChanged.delete(cb);
    });
    vi.mocked(window.api.lens.save).mockImplementation(async (project, input) => {
      const saved = { id: input.id ?? 'made', name: input.name, instruction: input.instruction };
      vi.mocked(window.api.lens.list).mockResolvedValue([saved]);
      for (const notify of listChanged) notify(project);
      return saved;
    });

    await openCodePane({
      files: [changed('src/api.ts')],
      // Never re-mocked: the stored grouping still says "Narrative", so the
      // picker has to get the new name from the list.
      lens: lensOnFile([{ title: 'Transport', slices: [{ path: 'src/api.ts' }] }], {
        lensId: NARRATIVE.id,
        lensName: NARRATIVE.name,
      }),
      lenses: [NARRATIVE],
    });

    await openPicker();
    pick('Manage lenses…');

    fireEvent.click(await screen.findByLabelText('Edit “Narrative”'));
    fireEvent.change(await screen.findByDisplayValue('Narrative'), { target: { value: 'Narrative v2' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(window.api.lens.save).toHaveBeenCalledWith(PROJECT, {
        id: 'narrative',
        name: 'Narrative v2',
        instruction: 'group by story',
      }),
    );
    expect(await screen.findByTitle('Reading this change through “Narrative v2”')).toBeTruthy();

    fireEvent.click(screen.getByText('Done'));
    await waitFor(() => expect(screen.queryByText('Add a lens')).toBeNull());

    await openPicker();
    const rows = screen.getAllByRole('menuitem').map((row) => row.textContent);
    expect(rows.filter((row) => row?.startsWith('Narrative'))).toEqual(['Narrative v21 part']);
  });

  test('a lens can be edited without running it', async () => {
    await openCodePane({ lens: null, lenses: [NARRATIVE] });

    await openPicker();
    pick('Manage lenses…');

    fireEvent.click(await screen.findByLabelText('Edit “Narrative”'));
    expect(await screen.findByDisplayValue('group by story')).toBeTruthy();
    expect(window.api.github.runLens).not.toHaveBeenCalled();
  });

  test('a finished run shows its lens and stops saying it is writing', async () => {
    vi.mocked(window.api.github.runLens).mockImplementation(async () => {
      vi.mocked(window.api.github.lens).mockResolvedValue(
        lensOnFile([{ title: 'Transport', slices: [{ path: 'src/api.ts' }] }], {
          lensId: NARRATIVE.id,
          lensName: NARRATIVE.name,
        }),
      );
      return { success: true };
    });
    await openCodePane({ files: [changed('src/api.ts')], lens: null, lenses: [NARRATIVE] });

    await openPicker();
    pick('Narrative');

    expect(await screen.findByTitle('Reading this change through “Narrative”')).toBeTruthy();
    expect(screen.queryByText(/Writing/)).toBeNull();
  });

  test('a failed run says so and stops spinning', async () => {
    vi.mocked(window.api.github.runLens).mockResolvedValue({ success: false, error: 'claude is not on PATH' });
    await openCodePane({ lens: null, lenses: [NARRATIVE] });

    await openPicker();
    pick('Narrative');

    await waitFor(() => expect(screen.queryByText(/Writing/)).toBeNull());
    expect(useProjectStore.getState().toasts.some((t) => t.message.includes('not on PATH'))).toBe(true);
  });

  test('the run survives closing the pull request', async () => {
    vi.mocked(window.api.github.runLens).mockReturnValue(new Promise(() => {}));
    await openCodePane({ lens: null, lenses: [NARRATIVE] });

    await openPicker();
    pick('Narrative');

    expect(await screen.findByText('Writing Narrative…')).toBeTruthy();

    useGithubStore.getState().closeDetail();
    await waitFor(() => expect(screen.queryByText('Writing Narrative…')).toBeNull());

    fireEvent.click(await screen.findByText('Please look'));
    fireEvent.click(await screen.findByText('Code'));
    expect(await screen.findByText('Writing Narrative…')).toBeTruthy();
  });

  test('a lens written elsewhere arrives without asking', async () => {
    let notify: ((payload: { projectPath: string; prNumber: number }) => void) | null = null;
    vi.mocked(window.api.github.onLensChanged).mockImplementation((cb) => {
      notify = cb;
      return () => {};
    });
    await openCodePane({ files: [changed('src/api.ts')], lens: null });

    expect(await screen.findByTitle('How to read this change')).toBeTruthy();

    // Written over the CLI, so no lens of the project's is named against it.
    vi.mocked(window.api.github.lens).mockResolvedValue(
      lensOnFile([{ title: 'Transport', slices: [{ path: 'src/api.ts' }] }]),
    );
    notify?.({ projectPath: PROJECT, prNumber: 5 });

    expect(await screen.findByTitle('Reading this change through a lens written for it')).toBeTruthy();
    expect(screen.getByText('Lens')).toBeTruthy();
    // One local read for the lens, and nothing else refetched.
    expect(window.api.github.pullRequest).toHaveBeenCalledTimes(1);
  });

  test('a lens for an older head is not applied', async () => {
    await openCodePane({ lens: lensOnFile(null, { stale: true }) });

    expect(await screen.findByTitle('How to read this change')).toBeTruthy();
    expect(screen.getByText('All files')).toBeTruthy();
  });

  test('a stale lens says so and offers to be written again', async () => {
    vi.mocked(window.api.github.runLens).mockReturnValue(new Promise(() => {}));
    await openCodePane({
      lens: lensOnFile(null, { stale: true, lensId: NARRATIVE.id, lensName: NARRATIVE.name }),
      lenses: [NARRATIVE],
    });

    expect(
      await screen.findByTitle('How to read this change — “Narrative” was written for earlier commits'),
    ).toBeTruthy();

    await openPicker();
    expect(screen.getByRole('menuitem', { name: 'Narrativeout of date' })).toBeTruthy();

    pick(/^Narrative/);
    await waitFor(() => expect(window.api.github.runLens).toHaveBeenCalledWith(PROJECT, 5, 'narrative'));
  });

  test('a stale lens the project cannot run again is left unsaid', async () => {
    await openCodePane({
      lens: lensOnFile(null, { stale: true, lensId: 'gone', lensName: 'Gone' }),
      lenses: [NARRATIVE],
    });

    expect(await screen.findByTitle('How to read this change')).toBeTruthy();
    await openPicker();
    expect(screen.queryByText('out of date')).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Narrative' })).toBeTruthy();
  });
});
