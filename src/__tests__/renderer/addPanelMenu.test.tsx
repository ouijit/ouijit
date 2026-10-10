import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TerminalHeader } from '../../components/terminal/TerminalHeader';
import { terminalInstances } from '../../components/terminal/terminalRegistry';
import { startRunner } from '../../components/terminal/terminalActions';
import { useProjectStore } from '../../stores/projectStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { DEFAULT_DISPLAY_STATE } from '../../stores/terminalDisplay';
import type { Script } from '../../types';

vi.mock('../../components/terminal/terminalReact', () => ({
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

    await waitFor(() => expect(startRunner).toHaveBeenCalledWith(PTY, undefined, undefined));
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
      expect(startRunner).toHaveBeenCalledWith(
        PTY,
        expect.objectContaining({ name: 'Test', command: 'npm test' }),
        undefined,
      ),
    );
    expect(window.api.scripts.save).toHaveBeenCalledWith(
      PROJECT,
      expect.objectContaining({ name: 'Test', command: 'npm test' }),
    );
  });

  test('runs a command on the host or in a sandbox from its row, shows it on hover, and edits it in place', async () => {
    const lint: Script = { id: 's1', name: 'Lint', command: 'npm run lint', sortOrder: 0, restartIfRunning: false };
    useProjectStore.setState({
      configProjectPath: PROJECT,
      scriptsProjectPath: PROJECT,
      configuredHooks: { run: true },
      scripts: [lint],
      availableSandboxProviders: ['custom'],
    });
    vi.mocked(window.api.hooks.get).mockResolvedValue({
      run: { id: 'h1', type: 'run', name: 'Run', command: 'npm run dev' },
    });

    openAddMenu();
    fireEvent.click(screen.getByText('Lint'));
    await waitFor(() => expect(startRunner).toHaveBeenLastCalledWith(PTY, lint, undefined));

    fireEvent.click(screen.getByLabelText('Add panel'));
    fireEvent.click(screen.getAllByLabelText('Run in Custom sandbox')[1]);
    await waitFor(() => expect(startRunner).toHaveBeenLastCalledWith(PTY, lint, 'custom'));

    fireEvent.click(screen.getByLabelText('Add panel'));
    fireEvent.click(screen.getAllByLabelText('Run in Custom sandbox')[0]);
    await waitFor(() => expect(startRunner).toHaveBeenLastCalledWith(PTY, undefined, 'custom'));

    fireEvent.click(screen.getByLabelText('Add panel'));
    // The run hook's edit appears once the hook itself has loaded; the script's is always there.
    await waitFor(() => expect(screen.getAllByLabelText('Edit')).toHaveLength(2));
    fireEvent.mouseEnter(screen.getByText('Run').parentElement!);
    expect(await screen.findByText('npm run dev')).toBeTruthy();

    fireEvent.click(screen.getAllByLabelText('Edit')[1]);
    const command = await screen.findByLabelText('Command');
    expect(screen.getByText('Edit Script')).toBeTruthy();
    expect((command as HTMLInputElement).value).toBe('npm run lint');
    fireEvent.change(command, { target: { value: 'npm run lint -- --fix' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(window.api.scripts.save).toHaveBeenCalledWith(PROJECT, { ...lint, command: 'npm run lint -- --fix' }),
    );
    expect(startRunner).toHaveBeenCalledTimes(3);
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
