import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, waitFor, fireEvent } from '@testing-library/react';

import { SandboxSection } from '../../components/scripts/SandboxSection';
import { useProjectStore } from '../../stores/projectStore';
import type { SandboxProviderId } from '../../types';

// LimaSandboxSection (reached via SandboxSection) transitively imports
// terminalActions -> terminalReact -> @xterm/xterm, which hangs when loaded
// for real under jsdom. Sever the chain like the other renderer tests do.
vi.mock('../../components/terminal/terminalActions', () => ({
  addProjectTerminal: vi.fn().mockResolvedValue(true),
  closeProjectTerminal: vi.fn(),
}));

function setAvailable(providers: SandboxProviderId[]) {
  useProjectStore.setState({ availableSandboxProviders: providers });
}

describe('SandboxSection provider router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Lima section polls status; keep it quiet.
    vi.mocked(window.api.lima.status).mockResolvedValue({ available: true, vmStatus: 'Stopped' });
    vi.mocked(window.api.lima.getYaml).mockResolvedValue('');
    vi.mocked(window.api.lima.getMergedYaml).mockResolvedValue('');
  });

  test('renders nothing when no backend is available', () => {
    setAvailable([]);
    const { container } = render(<SandboxSection projectPath="/p" />);
    expect(container.firstChild).toBeNull();
  });

  test('nono-only: shows the nono config surface, no backend picker', async () => {
    setAvailable(['nono']);
    const { queryByText, getByLabelText } = render(<SandboxSection projectPath="/p" />);
    await waitFor(() => expect(getByLabelText('Block outbound network')).toBeTruthy());
    // No picker tabs when a single backend.
    expect(queryByText('Lima VM')).toBeNull();
  });

  test('both backends: shows a picker to switch between them', async () => {
    setAvailable(['lima', 'nono']);
    const { getByText } = render(<SandboxSection projectPath="/p" />);
    await waitFor(() => {
      expect(getByText('Lima VM')).toBeTruthy();
      expect(getByText('nono')).toBeTruthy();
    });
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
    vi.mocked(window.api.sandbox.status).mockResolvedValue([{ providerId: 'custom', available: true, ready: true }]);
    vi.mocked(window.api.sandbox.setCustomConfig).mockImplementation(async (_p, cfg) =>
      cfg.command === 'scripts/sandbox' ? { success: false, error: 'refused by the main process' } : { success: true },
    );
    const { getByText, getByLabelText, queryByText, queryByLabelText } = render(<SandboxSection projectPath="/p" />);
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
