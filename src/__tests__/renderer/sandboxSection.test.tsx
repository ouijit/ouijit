import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, waitFor, fireEvent, within } from '@testing-library/react';

import { SandboxSection } from '../../components/scripts/SandboxSection';
import { useProjectStore } from '../../stores/projectStore';
import type { SandboxBackendId } from '../../types';

// The backend sections transitively import terminalActions -> terminalReact ->
// @xterm/xterm, which hangs when loaded for real under jsdom. Sever the chain
// like the other renderer tests do.
vi.mock('../../components/terminal/terminalActions', () => ({
  addProjectTerminal: vi.fn().mockResolvedValue(true),
  closeProjectTerminal: vi.fn(),
}));

function setStatuses(statuses: { providerId: SandboxBackendId; available: boolean; detail?: string }[]) {
  useProjectStore.setState({
    configProjectPath: '/p',
    sandboxStatuses: statuses,
    availableSandboxProviders: statuses.filter((st) => st.available).map((st) => st.providerId),
    runnerSandbox: 'none',
  });
}

describe('sandbox settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(window.api.sandbox.nonoConfig).mockResolvedValue({});
    vi.mocked(window.api.sandbox.status).mockResolvedValue([]);
  });

  test('nono is off until turned on, and its settings appear and persist once it is', async () => {
    vi.mocked(window.api.showFolderPicker).mockResolvedValue({ canceled: false, filePaths: ['/Users/dev/cache'] });
    setStatuses([
      { providerId: 'nono', available: false, detail: 'Off' },
      { providerId: 'custom', available: false },
    ]);
    const { getByRole } = render(<SandboxSection projectPath="/p" />);
    const nono = within(getByRole('region', { name: 'nono' }));

    const use = await waitFor(() => nono.getByRole('switch', { name: 'Use nono' }));
    expect(use.getAttribute('aria-checked')).toBe('false');
    expect(nono.queryByLabelText('Block outbound network')).toBeNull();

    fireEvent.click(use);
    await waitFor(() =>
      expect(window.api.sandbox.setNonoConfig).toHaveBeenCalledWith('/p', expect.objectContaining({ enabled: true })),
    );
    await waitFor(() => expect(window.api.sandbox.status).toHaveBeenCalledWith('/p'));

    fireEvent.click(nono.getByLabelText('Block outbound network'));
    await waitFor(() =>
      expect(window.api.sandbox.setNonoConfig).toHaveBeenLastCalledWith(
        '/p',
        expect.objectContaining({ enabled: true, blockNet: true }),
      ),
    );
    fireEvent.click(nono.getByText('+ Add folder'));
    await waitFor(() =>
      expect(window.api.sandbox.setNonoConfig).toHaveBeenLastCalledWith(
        '/p',
        expect.objectContaining({ allowPaths: ['/Users/dev/cache'] }),
      ),
    );
    fireEvent.change(nono.getByPlaceholderText('3000'), { target: { value: '8080' } });
    fireEvent.click(nono.getByText('+ Add'));
    await waitFor(() =>
      expect(window.api.sandbox.setNonoConfig).toHaveBeenLastCalledWith(
        '/p',
        expect.objectContaining({ openPorts: [8080] }),
      ),
    );
  });

  test('a nono that cannot run says why in place of its description', () => {
    setStatuses([{ providerId: 'nono', available: false, detail: 'Not installed' }]);
    const { getByRole } = render(<SandboxSection projectPath="/p" />);
    expect(within(getByRole('region', { name: 'nono' })).getByText('Not installed')).toBeTruthy();
  });

  test("Custom's launcher edits inline, shows the main-process verdict, and refreshes what can run", async () => {
    setStatuses([{ providerId: 'custom', available: false }]);
    vi.mocked(window.api.sandbox.status).mockResolvedValue([{ providerId: 'custom', available: true }]);
    vi.mocked(window.api.sandbox.setCustomConfig).mockImplementation(async (_p, cfg) =>
      cfg.command === 'scripts/sandbox' ? { success: false, error: 'refused by the main process' } : { success: true },
    );
    const { getByRole } = render(<SandboxSection projectPath="/p" />);
    const custom = within(getByRole('region', { name: 'Custom' }));
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

  test('the default environment is Host until a sandbox can run, then can be set to one', async () => {
    setStatuses([{ providerId: 'custom', available: false }]);
    const { getByText, getByRole, rerender } = render(<SandboxSection projectPath="/p" />);
    expect(getByText('Turn on nono or set a Custom command to choose a sandbox.')).toBeTruthy();

    setStatuses([{ providerId: 'custom', available: true }]);
    rerender(<SandboxSection projectPath="/p" />);
    fireEvent.click(getByRole('button', { name: 'Custom', pressed: false }));
    await waitFor(() => expect(useProjectStore.getState().runnerSandbox).toBe('custom'));
    expect(window.api.globalSettings.set).toHaveBeenCalledWith('runnerSandbox:/p', 'custom');
  });
});
