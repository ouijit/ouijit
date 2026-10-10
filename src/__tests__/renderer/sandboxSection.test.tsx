import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, waitFor, fireEvent } from '@testing-library/react';

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

function setAvailable(providers: SandboxBackendId[]) {
  useProjectStore.setState({ availableSandboxProviders: providers });
}

describe('SandboxSection provider router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('lists every backend, opens on nono, and says why the one shown cannot run', async () => {
    useProjectStore.setState({
      configProjectPath: '/p',
      availableSandboxProviders: [],
      sandboxStatuses: [
        { providerId: 'nono', available: false, detail: 'Not installed' },
        { providerId: 'custom', available: false, detail: 'Set a sandbox command to use it.' },
      ],
    });
    const { getByText, getByLabelText, queryByText } = render(<SandboxSection projectPath="/p" />);

    expect(getByText('Not installed')).toBeTruthy();
    expect(getByLabelText('Block outbound network')).toBeTruthy();
    expect(queryByText('Set a sandbox command to use it.')).toBeNull();

    fireEvent.click(getByText('Custom'));
    expect(getByText('Set a sandbox command to use it.')).toBeTruthy();
    expect(getByText('+ Configure')).toBeTruthy();
    expect(queryByText('Not installed')).toBeNull();
  });

  test('toggling the nono network restriction persists the config', async () => {
    setAvailable(['nono']);
    const { getByLabelText } = render(<SandboxSection projectPath="/p" />);
    const toggle = await waitFor(() => getByLabelText('Block outbound network'));
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(window.api.sandbox.setNonoConfig).toHaveBeenCalledWith('/p', expect.objectContaining({ blockNet: true })),
    );
  });

  test('adding a folder via the picker persists it to allowPaths', async () => {
    vi.mocked(window.api.showFolderPicker).mockResolvedValue({ canceled: false, filePaths: ['/Users/dev/cache'] });
    setAvailable(['nono']);
    const { getByText } = render(<SandboxSection projectPath="/p" />);
    const addBtn = await waitFor(() => getByText('Add folder'));
    fireEvent.click(addBtn);
    await waitFor(() =>
      expect(window.api.sandbox.setNonoConfig).toHaveBeenCalledWith(
        '/p',
        expect.objectContaining({ allowPaths: ['/Users/dev/cache'] }),
      ),
    );
  });

  test('custom: the command row edits inline, shows the main-process verdict, and refreshes availability', async () => {
    setAvailable(['custom']);
    vi.mocked(window.api.sandbox.status).mockResolvedValue([{ providerId: 'custom', available: true }]);
    vi.mocked(window.api.sandbox.setCustomConfig).mockImplementation(async (_p, cfg) =>
      cfg.command === 'scripts/sandbox' ? { success: false, error: 'refused by the main process' } : { success: true },
    );
    const { getByText, getByLabelText, queryByText, queryByLabelText } = render(<SandboxSection projectPath="/p" />);
    fireEvent.click(getByText('Custom'));
    fireEvent.click(await waitFor(() => getByText('+ Configure')));
    const field = getByLabelText('Sandbox command');
    vi.mocked(window.api.sandbox.status).mockClear();

    fireEvent.change(field, { target: { value: 'scripts/sandbox' } });
    fireEvent.click(getByText('Save'));
    await waitFor(() => expect(getByText(/refused by the main process/)).toBeTruthy());
    expect(getByLabelText('Sandbox command')).toBeTruthy();
    expect(window.api.sandbox.status).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: '  /opt/sb --strict  ' } });
    fireEvent.click(getByText('Save'));
    await waitFor(() =>
      expect(window.api.sandbox.setCustomConfig).toHaveBeenCalledWith('/p', { command: '  /opt/sb --strict  ' }),
    );
    await waitFor(() => expect(window.api.sandbox.status).toHaveBeenCalledWith('/p'));
    expect(queryByText(/refused by the main process/)).toBeNull();
    expect(queryByLabelText('Sandbox command')).toBeNull();
    expect(getByText('/opt/sb --strict')).toBeTruthy();

    fireEvent.click(getByText('Edit'));
    fireEvent.click(getByText('Clear'));
    await waitFor(() => expect(window.api.sandbox.setCustomConfig).toHaveBeenCalledWith('/p', {}));
    await waitFor(() => expect(queryByText('/opt/sb --strict')).toBeNull());
    expect(getByText('+ Configure')).toBeTruthy();
  });

  test('adding an extra port persists it to openPorts', async () => {
    setAvailable(['nono']);
    const { getByText, getByPlaceholderText } = render(<SandboxSection projectPath="/p" />);
    const input = await waitFor(() => getByPlaceholderText('3000'));
    fireEvent.change(input, { target: { value: '8080' } });
    fireEvent.click(getByText('Add'));
    await waitFor(() =>
      expect(window.api.sandbox.setNonoConfig).toHaveBeenCalledWith(
        '/p',
        expect.objectContaining({ openPorts: [8080] }),
      ),
    );
  });
});
