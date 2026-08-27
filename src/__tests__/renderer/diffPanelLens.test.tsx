import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

import { DiffPanel } from '../../components/diff/DiffPanel';
import { useUIStore, DIFF_FILE_LIST_DEFAULT_WIDTH } from '../../stores/uiStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { DEFAULT_DISPLAY_STATE } from '../../stores/terminalDisplay';
import { _resetLensRunsForTesting } from '../../components/diff/useLensSession';

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
  { path: 'src/db/repo.ts', status: 'M' as const, additions: 4, deletions: 1 },
  { path: 'src/db/schema.ts', status: 'M' as const, additions: 2, deletions: 0 },
  { path: 'src/ui/Panel.tsx', status: 'M' as const, additions: 3, deletions: 3 },
];

const LENS = {
  lensName: 'Narrative',
  stale: false,
  groups: [
    {
      title: 'Where it is stored',
      summary: 'The table and the rows that go in it',
      slices: [{ path: 'src/db/schema.ts' }, { path: 'src/db/repo.ts' }],
    },
  ],
};

/**
 * A worktree diff read through a lens.
 *
 * The engine is shared with the pull request pane and covered there; what is
 * only true here is that the panel's own rail chapters, and that the reader can
 * fold a part away on either side of the seam.
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
    vi.mocked(window.api.lens.list).mockResolvedValue([{ name: 'Narrative', instruction: 'group by story' }]);
    vi.mocked(window.api.getFileDiff).mockResolvedValue(null);
    vi.mocked(window.api.worktree.getFileDiff).mockResolvedValue(null);
  });

  test('the rail chapters, keeping the directories, and a part folds on both sides at once', async () => {
    render(<DiffPanel {...PROPS} />);

    // Read for this worktree and applied without asking, the same as the pull
    // request pane does it.
    await waitFor(() => expect(window.api.diffLens.get).toHaveBeenCalled());
    expect((await screen.findAllByText('Where it is stored')).length).toBe(2);

    // Which layer a part touches is most of what says what kind of change it
    // is, so the tree inside a chapter is the same tree the flat list draws.
    expect(await screen.findByText('src/db')).toBeTruthy();
    // The summary sits in the document, under the title and above the files.
    expect(screen.getByText('The table and the rows that go in it')).toBeTruthy();

    // A file no part claimed is still in the diff — a lens reorders and splits,
    // and never hides.
    expect(screen.getAllByText('Not in this lens').length).toBeGreaterThan(0);

    // One part of the change is one thing: folding it in the rail puts it away
    // in the document too.
    fireEvent.click(screen.getAllByRole('button', { expanded: true, name: /Where it is stored/ })[0]);
    await waitFor(() => {
      expect(screen.queryByText('The table and the rows that go in it')).toBeNull();
    });
    expect(screen.getAllByText('Where it is stored').length).toBe(2);
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
