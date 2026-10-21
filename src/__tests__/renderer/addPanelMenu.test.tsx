import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TerminalHeader } from '../../components/terminal/TerminalHeader';
import { terminalInstances } from '../../components/terminal/terminalRegistry';
import { startRunner } from '../../components/terminal/terminalActions';
import { getProjectConfig, useProjectDataStore } from '../../stores/projectDataStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { DEFAULT_DISPLAY_STATE } from '../../stores/terminalDisplay';
import type { ProjectHooks, SandboxBackendId, SandboxProviderId, Script } from '../../types';

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

function seed(
  projectPath: string,
  {
    hooks = {},
    scripts = [],
    sandboxes = [],
    defaultSandbox = 'none',
  }: { hooks?: ProjectHooks; scripts?: Script[]; sandboxes?: SandboxBackendId[]; defaultSandbox?: SandboxProviderId },
) {
  useProjectDataStore.setState((s) => ({
    configByProject: {
      ...s.configByProject,
      [projectPath]: { sandboxStatuses: [], availableSandboxProviders: sandboxes, hooks, defaultSandbox },
    },
    scriptsByProject: { ...s.scriptsByProject, [projectPath]: scripts },
  }));
}

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
    useProjectDataStore.setState({ configByProject: {}, scriptsByProject: {} });
  });

  test('with no commands, still offers a new script, and a run command saved from it starts', async () => {
    seed(PROJECT, {});
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
    seed(PROJECT, {
      hooks: { run: { id: 'h1', type: 'run', name: 'Run', command: 'npm run dev' } },
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

  test("commands run in the project's default environment, which the menu sets without running anything", async () => {
    const lint: Script = { id: 's1', name: 'Lint', command: 'npm run lint', sortOrder: 0, restartIfRunning: false };
    seed(PROJECT, {
      hooks: { run: { id: 'h1', type: 'run', name: 'Run', command: 'npm run dev' } },
      scripts: [lint],
      sandboxes: ['custom'],
      defaultSandbox: 'custom',
    });

    openAddMenu();
    fireEvent.click(screen.getByText('Lint'));
    await waitFor(() => expect(startRunner).toHaveBeenLastCalledWith(PTY, lint, 'custom'));

    fireEvent.click(screen.getByLabelText('Add panel'));
    fireEvent.mouseEnter(screen.getByText('Default environment').closest('div')!);
    fireEvent.click(await screen.findByRole('button', { name: 'Host' }));
    await waitFor(() => expect(getProjectConfig(PROJECT)?.defaultSandbox).toBe('none'));
    expect(window.api.globalSettings.set).toHaveBeenCalledWith(`runnerSandbox:${PROJECT}`, 'none');
    expect(startRunner).toHaveBeenCalledTimes(1);

    // The menu stays open on its new default, ready for the command to run.
    fireEvent.click(screen.getByText('Lint'));
    await waitFor(() => expect(startRunner).toHaveBeenLastCalledWith(PTY, lint, undefined));

    fireEvent.click(screen.getByLabelText('Add panel'));
    fireEvent.click(screen.getByLabelText('Edit Lint'));
    const command = await screen.findByLabelText('Command');
    expect(screen.getByText('Edit Script')).toBeTruthy();
    fireEvent.change(command, { target: { value: 'npm run lint -- --fix' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() =>
      expect(window.api.scripts.save).toHaveBeenCalledWith(PROJECT, { ...lint, command: 'npm run lint -- --fix' }),
    );
    expect(startRunner).toHaveBeenCalledTimes(2);
  });

  test("lists the terminal's own project's commands, loaded when another project's are the only ones held", async () => {
    seed('/elsewhere', {
      scripts: [{ id: 's1', name: 'Lint', command: 'npm run lint', sortOrder: 0, restartIfRunning: false }],
    });
    const its: Script = { id: 's2', name: 'Build', command: 'make', sortOrder: 0, restartIfRunning: false };
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
