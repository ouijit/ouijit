import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// terminalReact pulls xterm in, which hangs under jsdom, and the header reaches
// it (and terminalActions behind it) only for things this test does not touch.
vi.mock('../../components/terminal/terminalReact', () => ({
  terminalInstances: new Map(),
  refreshTerminalGitStatus: vi.fn().mockResolvedValue(undefined),
}));

import { TerminalHeader } from '../../components/terminal/TerminalHeader';
import { useTerminalStore } from '../../stores/terminalStore';
import { DEFAULT_DISPLAY_STATE } from '../../stores/terminalDisplay';
import type { GitFileStatus } from '../../types';

const PTY = 'pty-1';

function mount(gitFileStatus: GitFileStatus | null) {
  useTerminalStore.setState({
    displayStates: {
      [PTY]: { ...DEFAULT_DISPLAY_STATE, ptyId: PTY, projectPath: '/p', gitFileStatus },
    },
  });
  render(<TerminalHeader ptyId={PTY} isActive onClose={() => {}} />);
}

function status(changed: number): GitFileStatus {
  return {
    branch: 'feat/x',
    mainBranch: 'main',
    base: 'main',
    commitsAheadOfMain: 1,
    changedFiles: Array.from({ length: changed }, (_, i) => ({
      path: `f${i}.ts`,
      status: 'M' as const,
      additions: 2,
      deletions: 1,
    })),
    untrackedFiles: [],
  };
}

describe('the way into the diff panel', () => {
  beforeEach(() => {
    useTerminalStore.setState({ displayStates: {} });
  });

  test('states the size of the change when there is one', () => {
    mount(status(3));
    expect(screen.getByText('3 files')).toBeTruthy();
    expect(screen.getByText('+6')).toBeTruthy();
    expect(screen.getByText('-3')).toBeTruthy();
  });

  /**
   * The panel is where another comparison is chosen, so a card with nothing to
   * show against its own base still has to open — otherwise the rest of the
   * comparisons are unreachable from a branch that is fully committed.
   */
  test('is still offered when the comparison it opens on is empty', () => {
    mount(status(0));
    expect(screen.getByLabelText('Diff')).toBeTruthy();
    expect(screen.queryByText('0 files')).toBeNull();
  });

  test('and not offered at all where there is no repo to read', () => {
    mount(null);
    expect(screen.queryByLabelText('Diff')).toBeNull();
  });
});
