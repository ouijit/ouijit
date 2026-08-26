import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import { DiffPanel } from '../../components/diff/DiffPanel';
import { useUIStore, hydrateUIPreferences, DIFF_FILE_LIST_DEFAULT_WIDTH } from '../../stores/uiStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { DEFAULT_DISPLAY_STATE } from '../../stores/terminalDisplay';

// terminalReact pulls xterm in, which hangs under jsdom.
vi.mock('../../components/terminal/terminalReact', () => ({
  terminalInstances: new Map([['pty-1', { worktreePath: '/w', mergeTarget: 'main' }]]),
  refreshTerminalGitStatus: vi.fn().mockResolvedValue(undefined),
}));

const PROPS = {
  ptyId: 'pty-1',
  projectPath: '/w',
  fullWidth: true,
  onToggleFullWidth: vi.fn(),
  onClose: vi.fn(),
};

const settings = new Map<string, string>();

function openPanel() {
  return render(<DiffPanel {...PROPS} />);
}

/** Everything the store held is gone; only what reached settings can come back. */
async function relaunch() {
  cleanup();
  useUIStore.setState({ diffFileListCollapsed: false, diffFileListWidth: DIFF_FILE_LIST_DEFAULT_WIDTH });
  await hydrateUIPreferences();
}

const resizer = () => screen.queryByRole('separator', { name: 'Resize the file list' });

function dragResizerBy(distance: number) {
  const handle = resizer();
  if (!handle) throw new Error('the file list has no resize handle');
  fireEvent.mouseDown(handle, { clientX: 0 });
  fireEvent.mouseMove(document, { clientX: distance });
  fireEvent.mouseUp(document);
}

describe('the file list beside a diff', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    settings.clear();
    vi.mocked(window.api.globalSettings.get).mockImplementation(async (key) => settings.get(key));
    vi.mocked(window.api.globalSettings.set).mockImplementation(async (key, value) => {
      settings.set(key, value);
      return { success: true };
    });
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
            commitsAheadOfMain: 0,
            changedFiles: [],
            untrackedFiles: [],
          },
        },
      },
    });
  });

  test('a resized, hidden list comes back that way from a rebuild and from a fresh launch', async () => {
    let panel = openPanel();

    dragResizerBy(120);
    panel.unmount();
    panel = openPanel();
    expect(resizer()?.getAttribute('aria-valuenow')).toBe('340');

    fireEvent.click(screen.getByRole('button', { name: 'Hide the file list' }));
    panel.unmount();
    openPanel();
    expect(resizer()).toBeNull();

    await relaunch();
    openPanel();

    expect(resizer()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show the file list' }));
    expect(resizer()?.getAttribute('aria-valuenow')).toBe('340');
  });
});
