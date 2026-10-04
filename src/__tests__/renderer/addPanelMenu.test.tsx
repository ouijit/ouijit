import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TerminalHeader } from '../../components/terminal/TerminalHeader';
import { terminalInstances } from '../../components/terminal/terminalReact';
import { startRunner } from '../../components/terminal/terminalActions';
import { useProjectStore } from '../../stores/projectStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { DEFAULT_DISPLAY_STATE } from '../../stores/terminalDisplay';
import type { Script } from '../../types';

vi.mock('../../components/terminal/terminalReact', () => ({
  terminalInstances: new Map(),
  refreshTerminalGitStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../components/terminal/terminalActions', () => ({
  addProjectTerminal: vi.fn(),
  renameTerminal: vi.fn(),
  startRunner: vi.fn().mockResolvedValue(null),
}));

const PROJECT = '/tmp/project';
const PTY = 'pty-1';

function openAddMenu() {
  render(<TerminalHeader ptyId={PTY} isActive onClose={() => {}} />);
  fireEvent.click(screen.getByLabelText('Add panel'));
}

describe("the terminal's + menu", () => {
  beforeEach(() => {
    vi.mocked(startRunner).mockClear();
    (terminalInstances as Map<string, unknown>).set(PTY, { projectPath: PROJECT });
    useTerminalStore.setState({
      displayStates: { [PTY]: { ...DEFAULT_DISPLAY_STATE, ptyId: PTY, projectPath: PROJECT } },
    });
  });

  test('with no commands, still offers a new script, and a run command saved from it starts', async () => {
    useProjectStore.setState({
      configProjectPath: PROJECT,
      scriptsProjectPath: PROJECT,
      configuredHooks: {},
      scripts: [],
    });
    openAddMenu();

    expect(screen.getByText('New script…')).toBeTruthy();
    fireEvent.click(screen.getByText('Configure run command…'));
    fireEvent.change(await screen.findByLabelText('Command'), { target: { value: 'npm run dev' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(startRunner).toHaveBeenCalledWith(PTY, undefined));
    expect(window.api.hooks.save).toHaveBeenCalledWith(
      PROJECT,
      expect.objectContaining({ type: 'run', command: 'npm run dev' }),
    );

    fireEvent.click(screen.getByLabelText('Add panel'));
    expect(screen.getByText('Run')).toBeTruthy();
    expect(screen.queryByText('Configure run command…')).toBeNull();
  });

  test('a new script is saved and run, alongside the existing commands', async () => {
    const existing: Script = { id: 's1', name: 'Lint', command: 'npm run lint', sortOrder: 0, restartIfRunning: false };
    useProjectStore.setState({
      configProjectPath: PROJECT,
      scriptsProjectPath: PROJECT,
      configuredHooks: { run: true },
      scripts: [existing],
    });
    openAddMenu();

    expect(screen.getByText('Run')).toBeTruthy();
    expect(screen.getByText('Lint')).toBeTruthy();
    expect(screen.queryByText('Configure run command…')).toBeNull();

    fireEvent.click(screen.getByText('New script…'));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Test' } });
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'npm test' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(startRunner).toHaveBeenCalledWith(PTY, expect.objectContaining({ name: 'Test', command: 'npm test' })),
    );
    expect(window.api.scripts.save).toHaveBeenCalledWith(
      PROJECT,
      expect.objectContaining({ name: 'Test', command: 'npm test' }),
    );
  });

  test.each([
    ['belongs to another project', '/elsewhere'],
    ["has this project's config but still another's scripts", PROJECT],
  ])("lists the terminal's own project's commands while the store %s", async (_, configProjectPath) => {
    const storeScript: Script = {
      id: 's1',
      name: 'Lint',
      command: 'npm run lint',
      sortOrder: 0,
      restartIfRunning: false,
    };
    const its: Script = { id: 's2', name: 'Build', command: 'make', sortOrder: 0, restartIfRunning: false };
    useProjectStore.setState({
      configProjectPath,
      configuredHooks: {},
      scriptsProjectPath: '/elsewhere',
      scripts: [storeScript],
    });
    vi.mocked(window.api.hooks.get).mockResolvedValueOnce({
      run: { id: 'h1', type: 'run', name: 'Run', command: 'npm run dev' },
    });
    vi.mocked(window.api.scripts.getAll).mockResolvedValueOnce([its]);
    openAddMenu();

    expect(await screen.findByText('Build')).toBeTruthy();
    expect(screen.getByText('Run')).toBeTruthy();
    expect(screen.queryByText('Lint')).toBeNull();
    expect(screen.queryByText('Configure run command…')).toBeNull();
  });
});
