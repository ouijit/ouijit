import { describe, test, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

import { DiffPanel } from '../../components/diff/DiffPanel';
import { useUIStore, DIFF_FILE_LIST_DEFAULT_WIDTH } from '../../stores/uiStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { DEFAULT_DISPLAY_STATE } from '../../stores/terminalDisplay';
import { _resetLensRunsForTesting } from '../../components/diff/useLensSession';
import { NARRATIVE, hunk, lensOnFile } from '../lensFixtures';

// terminalReact pulls xterm in, which hangs under jsdom.
vi.mock('../../components/terminal/terminalReact', () => ({
  terminalInstances: new Map([['pty-1', { worktreePath: '/w', mergeTarget: 'main', label: 'T-1' }]]),
  refreshTerminalGitStatus: vi.fn().mockResolvedValue(undefined),
}));

const PROPS = {
  ptyId: 'pty-1',
  projectPath: '/w',
  fullWidth: true,
  onToggleFullWidth: vi.fn(),
  onClose: vi.fn(),
};

const FILES = [
  { path: 'src/db/repo.ts', status: 'M' as const, additions: 6, deletions: 1 },
  { path: 'src/db/schema.ts', status: 'M' as const, additions: 2, deletions: 0 },
  { path: 'src/ui/Panel.tsx', status: 'M' as const, additions: 3, deletions: 3 },
];

const WROTE = { lensId: NARRATIVE.id, lensName: NARRATIVE.name };

const LENS = lensOnFile(
  [
    {
      title: 'Where it is stored',
      summary: 'The table and the rows that go in it',
      slices: [{ path: 'src/db/schema.ts' }, { path: 'src/db/repo.ts' }],
    },
  ],
  WROTE,
);

/**
 * `repo.ts` in two pieces. Nothing else in `FILES` adds one or five lines, so a
 * count on screen says which piece it belongs to.
 */
const REPO_DIFF = {
  path: 'src/db/repo.ts',
  hunks: [
    {
      header: '@@ -1,2 +1,2 @@',
      lines: [
        { type: 'addition' as const, content: 'a', newLineNo: 1 },
        { type: 'deletion' as const, content: 'b', oldLineNo: 1 },
      ],
    },
    hunk(20, 5),
  ],
};

/** The same file in two parts of the story, a hunk each. */
const SPLIT_LENS = lensOnFile(
  [
    { title: 'Where it is stored', slices: [{ path: 'src/db/repo.ts', ranges: [[20, 24]] }] },
    { title: 'What reads it', slices: [{ path: 'src/db/repo.ts', ranges: [[1, 1]] }] },
  ],
  WROTE,
);

/** A save under the reader: the same files, one of them a different size. */
function edit({ additions }: { additions: number }): void {
  const display = useTerminalStore.getState().displayStates['pty-1'];
  useTerminalStore.setState({
    displayStates: {
      'pty-1': {
        ...display,
        gitFileStatus: { ...display.gitFileStatus!, changedFiles: [{ ...FILES[0], additions }, ...FILES.slice(1)] },
      },
    },
  });
}

/**
 * A worktree diff read through a lens. The engine is shared with the pull
 * request pane and covered there; what is only true here is the panel's own
 * chaptered rail, and folding a part away on either side of the seam.
 */
describe('the diff panel, read through a lens', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    _resetLensRunsForTesting();
    useUIStore.setState({ diffFileListCollapsed: false, diffFileListWidth: DIFF_FILE_LIST_DEFAULT_WIDTH });
    useTerminalStore.setState({
      displayStates: {
        'pty-1': {
          ...DEFAULT_DISPLAY_STATE,
          ptyId: 'pty-1',
          projectPath: '/w',
          gitFileStatus: {
            branch: 'feat/x',
            base: 'main',
            mainBranch: 'main',
            commitsAheadOfMain: 1,
            changedFiles: FILES,
            untrackedFiles: [],
          },
        },
      },
    });
    vi.mocked(window.api.diffLens.get).mockResolvedValue(LENS);
    vi.mocked(window.api.lens.list).mockResolvedValue([NARRATIVE]);
    vi.mocked(window.api.getFileDiff).mockResolvedValue(null);
    vi.mocked(window.api.worktree.getFileDiff).mockResolvedValue(null);
  });

  test('the rail chapters, keeping the directories, and a part folds on both sides at once', async () => {
    render(<DiffPanel {...PROPS} />);

    await waitFor(() => expect(window.api.diffLens.get).toHaveBeenCalled());
    expect((await screen.findAllByText('Where it is stored')).length).toBe(2);

    // The tree inside a chapter is the tree the flat list draws.
    expect(await screen.findByText('src/db')).toBeTruthy();
    expect(screen.getByText('The table and the rows that go in it')).toBeTruthy();

    // A file no part claimed is still in the diff: a lens never hides.
    expect(screen.getAllByText('Not in this lens').length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole('button', { expanded: true, name: /Where it is stored/ })[0]);
    await waitFor(() => {
      expect(screen.queryByText('The table and the rows that go in it')).toBeNull();
    });
    expect(screen.getAllByText('Where it is stored').length).toBe(2);
  });

  test('the diff moving re-reads the lens in place, without blanking it or overriding the reader', async () => {
    render(<DiffPanel {...PROPS} />);
    await screen.findAllByText('Where it is stored');

    // Held open, so what is on screen mid-read is what this asserts on.
    let land = (): void => {};
    vi.mocked(window.api.diffLens.get).mockReturnValue(
      new Promise((resolve) => {
        land = () => resolve(LENS);
      }),
    );

    await act(async () => edit({ additions: 9 }));
    await waitFor(() => expect(window.api.diffLens.get).toHaveBeenCalledTimes(2));
    // Dropping it first would blank the pane and redraw it on every save.
    expect(screen.getAllByText('Where it is stored').length).toBe(2);
    await act(async () => land());
    expect(screen.getAllByText('Where it is stored').length).toBe(2);

    // Applying an arriving lens is for a diff just opened, not one being edited.
    fireEvent.click(screen.getByTitle(/^(How to read|Reading) this change/));
    fireEvent.click(screen.getByRole('menuitem', { name: /^All files/ }));
    expect(screen.queryByText('Where it is stored')).toBeNull();

    await act(async () => edit({ additions: 11 }));
    await waitFor(() => expect(window.api.diffLens.get).toHaveBeenCalledTimes(3));
    expect(screen.queryByText('Where it is stored')).toBeNull();
  });

  test('a run this pane never started shows as running, and is let go when it ends', async () => {
    vi.mocked(window.api.diffLens.get).mockResolvedValue(
      lensOnFile(null, { running: { ...WROTE, since: null, live: true } }),
    );
    render(<DiffPanel {...PROPS} />);

    expect(await screen.findByText('Writing Narrative…')).toBeTruthy();

    // It ended in main, which nothing here was told: the next read is what puts
    // the spinner down.
    vi.mocked(window.api.diffLens.get).mockResolvedValue(LENS);
    await act(async () => edit({ additions: 9 }));
    await waitFor(() => expect(screen.queryByText('Writing Narrative…')).toBeNull());
    expect((await screen.findAllByText('Where it is stored')).length).toBe(2);
  });

  test('a run the app was closed out from under is offered again', async () => {
    const since = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    vi.mocked(window.api.diffLens.get).mockResolvedValue(
      lensOnFile(null, { running: { ...WROTE, since, live: false } }),
    );
    render(<DiffPanel {...PROPS} />);

    fireEvent.click(await screen.findByTitle(/“Narrative” did not finish/));
    const row = screen.getByRole('menuitem', { name: /^Narrative/ });
    expect(row.textContent).toContain('did not finish');
    expect(row.getAttribute('title')).toContain('Started 3 hours ago');

    fireEvent.click(row);
    await waitFor(() => expect(window.api.diffLens.run).toHaveBeenCalledWith(expect.anything(), 'narrative'));
  });

  test('a file split across two parts is navigated, counted and folded a part at a time', async () => {
    vi.mocked(window.api.diffLens.get).mockResolvedValue(SPLIT_LENS);
    vi.mocked(window.api.worktree.getFileDiff).mockImplementation((_path, _base, file) =>
      Promise.resolve(file === 'src/db/repo.ts' ? REPO_DIFF : null),
    );
    // jsdom has no layout, so the jump is only observable as the element it
    // was asked to bring into view.
    const landed: Element[] = [];
    Element.prototype.scrollIntoView = function scrollIntoView() {
      landed.push(this);
    };

    const { container } = render(<DiffPanel {...PROPS} />);
    await screen.findAllByText('What reads it');
    await waitFor(() => expect(container.querySelector('[data-group="1:What reads it"] .diff-card')).toBeTruthy());

    const stored = container.querySelector('[data-group="0:Where it is stored"] .diff-card')!;
    const read = container.querySelector('[data-group="1:What reads it"] .diff-card')!;
    expect(stored.textContent).toContain('+5');
    expect(read.textContent).toContain('+1');
    expect(read.textContent).toContain('-1');
    expect(screen.queryByText('+6')).toBeNull();

    // The rail is the sidebar, which the panel renders before the document.
    const chapter = screen.getAllByRole('button', { name: /What reads it/ })[0].parentElement!;
    expect(chapter.textContent).toContain('+1');

    fireEvent.click(chapter.querySelector('[data-path="src/db/repo.ts"]')!);
    expect(landed[0].closest('[data-group]')?.getAttribute('data-group')).toBe('1:What reads it');

    // Folding one copy leaves the other open.
    fireEvent.click(read.querySelector('button[aria-label="Collapse"]')!);
    expect(read.querySelector('button[aria-pressed="true"]')).toBeTruthy();
    expect(stored.querySelector('button[aria-pressed="true"]')).toBeNull();
    expect(stored.textContent).toContain('+5');
  });

  test('a grouping that arrives lays its parts in; one the pane opened on does not', async () => {
    vi.mocked(window.api.diffLens.get).mockResolvedValue(SPLIT_LENS);
    vi.mocked(window.api.worktree.getFileDiff).mockImplementation((_path, _base, file) =>
      Promise.resolve(file === 'src/db/repo.ts' ? REPO_DIFF : null),
    );
    const opened = render(<DiffPanel {...PROPS} />);

    await screen.findAllByText('What reads it');
    expect(opened.container.querySelectorAll('.lens-part-enter').length).toBe(0);

    cleanup();
    _resetLensRunsForTesting();
    vi.mocked(window.api.diffLens.get).mockResolvedValue(null);
    vi.mocked(window.api.diffLens.run).mockResolvedValue({ success: true });
    const reading = render(<DiffPanel {...PROPS} />);
    await waitFor(() => expect(window.api.diffLens.get).toHaveBeenCalled());
    expect(screen.queryByText('What reads it')).toBeNull();

    vi.mocked(window.api.diffLens.get).mockResolvedValue(SPLIT_LENS);
    fireEvent.click(screen.getByTitle(/^(How to read|Reading) this change/));
    fireEvent.click(screen.getByRole('menuitem', { name: /^Narrative/ }));
    await screen.findAllByText('What reads it');

    // Both sides of the seam, so the rail and the document settle together.
    const parts = [...reading.container.querySelectorAll<HTMLElement>('.lens-part-enter')];
    const delays = parts.map((part) => part.style.animationDelay);
    expect(delays).toEqual(['0ms', '55ms', '110ms', '0ms', '55ms', '110ms']);
  });

  test('All files goes back to the flat list without writing a second lens', async () => {
    render(<DiffPanel {...PROPS} />);
    await screen.findAllByText('Where it is stored');

    fireEvent.click(screen.getByTitle(/^(How to read|Reading) this change/));
    fireEvent.click(screen.getByRole('menuitem', { name: /^All files/ }));

    expect(screen.queryByText('Where it is stored')).toBeNull();
    expect(window.api.diffLens.run).not.toHaveBeenCalled();
  });
});
