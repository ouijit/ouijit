import { test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MainView } from '../../components/MainView';
import { SNAPSHOT_KEY } from '../../components/terminal/sessionSnapshot';
import { useAppStore } from '../../stores/appStore';
import { useTerminalStore } from '../../stores/terminalStore';
import type { LastSessionSnapshot } from '../../types';

// xterm cannot construct under jsdom.
vi.mock('../../components/terminal/terminalReact', () => ({ OuijitTerminal: class {} }));

const ALPHA = { path: '/code/alpha', name: 'Alpha' };

test('with nothing selected, the main area offers to resume the last session even when no project has a task', async () => {
  const snapshot: LastSessionSnapshot = {
    version: 1,
    capturedAt: new Date().toISOString(),
    activeProjectPath: ALPHA.path,
    terminals: [
      {
        ptyId: 'gone',
        projectPath: ALPHA.path,
        taskNumber: null,
        worktreePath: null,
        worktreeBranch: null,
        label: null,
        ordinalInProject: 0,
        isActiveInProject: true,
        ui: {},
      },
    ],
  };
  vi.mocked(window.api.globalSettings.get).mockImplementation(async (key) =>
    key === SNAPSHOT_KEY ? JSON.stringify(snapshot) : undefined,
  );
  vi.mocked(window.api.pty.getActiveSessions).mockResolvedValue([]);
  useTerminalStore.setState(useTerminalStore.getInitialState(), true);
  useAppStore.setState({ projects: [ALPHA], homeRecents: [] });
  useAppStore.getState().select({ kind: 'none' });

  render(<MainView />);

  expect(await screen.findByRole('button', { name: 'Resume' })).toBeTruthy();
  expect(screen.getByText('No tasks yet.')).toBeTruthy();
});
