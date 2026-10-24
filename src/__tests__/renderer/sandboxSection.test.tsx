import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, waitFor, fireEvent, screen } from '@testing-library/react';

import { SandboxSection } from '../../components/scripts/SandboxSection';
import { getProjectConfig } from '../../stores/projectDataStore';
import type { SandboxBackendId } from '../../types';
import { seedProject } from './seedProject';

// The backend sections transitively import terminalActions -> terminalReact ->
// @xterm/xterm, which hangs when loaded for real under jsdom. Sever the chain
// like the other renderer tests do.
vi.mock('../../components/terminal/terminalActions', () => ({
  addProjectTerminal: vi.fn().mockResolvedValue(true),
  closeProjectTerminal: vi.fn(),
}));

function setStatuses(statuses: { providerId: SandboxBackendId; available: boolean; detail?: string }[]) {
  seedProject('/p', { sandboxStatuses: statuses });
}

describe('sandbox settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(window.api.sandbox.status).mockResolvedValue([]);
    vi.mocked(window.api.homePath).mockResolvedValue('/home');
  });

  test('the default and the CLI access are picked from menus, and a default that cannot run says why', async () => {
    setStatuses([
      { providerId: 'nono', available: true },
      { providerId: 'custom', available: false, detail: 'Set a launcher first.' },
    ]);
    render(<SandboxSection projectPath="/p" />);
    expect(screen.getByText('Where terminals, hooks and scripts run.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Default' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sandbox' }));
    await waitFor(() => expect(getProjectConfig('/p')?.defaultSandbox).toBe('nono'));
    expect(window.api.globalSettings.set).toHaveBeenCalledWith('defaultSandbox:/p', 'nono');

    fireEvent.click(screen.getByRole('button', { name: 'Default' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Custom' }));
    await waitFor(() => expect(screen.getByText("Custom can't run. Set a launcher first.")).toBeTruthy());

    expect(
      screen.getByText('Sandboxed commands can read their task, draft comments, and ask you to run a command.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ouijit CLI access' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Everything' }));
    await waitFor(() => expect(getProjectConfig('/p')?.sandboxCliAccess).toBe('all'));
    expect(window.api.globalSettings.set).toHaveBeenCalledWith('sandboxCliAccess:/p', 'all');
    expect(screen.getByText('Sandboxed commands can make Ouijit run anything on the host.')).toBeTruthy();
  });

  test("the sandbox profile is the project's own file until another is chosen, and Reset goes back to it", async () => {
    setStatuses([{ providerId: 'nono', available: true }]);
    vi.mocked(window.api.sandbox.chooseNonoProfile).mockResolvedValue({ path: '/shared/strict.json', own: false });
    render(<SandboxSection projectPath="/p" />);

    await waitFor(() => expect(screen.getByText('~/.config/nono/profiles/ouijit-p.json')).toBeTruthy());
    expect(screen.queryByText('Reset')).toBeNull();
    fireEvent.click(screen.getByText('Open'));
    expect(window.api.sandbox.openNonoProfile).toHaveBeenCalledWith('/p');

    fireEvent.click(screen.getByText('Change…'));
    await waitFor(() => expect(screen.getByText('/shared/strict.json')).toBeTruthy());
    fireEvent.click(screen.getByText('Reset'));
    await waitFor(() => expect(screen.getByText('~/.config/nono/profiles/ouijit-p.json')).toBeTruthy());
    expect(window.api.sandbox.resetNonoProfile).toHaveBeenCalledWith('/p');
  });

  test('a sandbox that cannot run says why in place of its profile', () => {
    setStatuses([{ providerId: 'nono', available: false, detail: 'Not installed' }]);
    render(<SandboxSection projectPath="/p" />);
    expect(screen.getByText('Not installed')).toBeTruthy();
  });

  test("Custom's launcher edits inline, shows the main-process verdict, and refreshes what can run", async () => {
    setStatuses([{ providerId: 'custom', available: false }]);
    vi.mocked(window.api.sandbox.status).mockResolvedValue([{ providerId: 'custom', available: true }]);
    vi.mocked(window.api.sandbox.setCustomConfig).mockImplementation(async (_p, cfg) =>
      cfg.command === 'scripts/sandbox' ? { success: false, error: 'refused by the main process' } : { success: true },
    );
    render(<SandboxSection projectPath="/p" />);
    const custom = screen;
    expect(custom.getByText('Not set')).toBeTruthy();

    fireEvent.click(await waitFor(() => custom.getByText('+ Configure')));
    const field = custom.getByLabelText('Launcher command');
    fireEvent.change(field, { target: { value: 'scripts/sandbox' } });
    fireEvent.click(custom.getByText('Save'));
    await waitFor(() => expect(custom.getByText(/refused by the main process/)).toBeTruthy());
    expect(window.api.sandbox.status).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: '  /opt/sb --strict  ' } });
    fireEvent.click(custom.getByText('Save'));
    await waitFor(() => expect(custom.getByText('/opt/sb --strict')).toBeTruthy());
    expect(window.api.sandbox.status).toHaveBeenCalledWith('/p');
    expect(custom.queryByLabelText('Launcher command')).toBeNull();

    fireEvent.click(custom.getByText('Edit'));
    fireEvent.click(custom.getByText('Clear'));
    await waitFor(() => expect(window.api.sandbox.setCustomConfig).toHaveBeenLastCalledWith('/p', {}));
    await waitFor(() => expect(custom.getByText('Not set')).toBeTruthy());
  });
});
