import { describe, test, expect, vi, beforeEach } from 'vitest';

import { registerPtyHandlers } from '../ipc/handlers/pty';

// Capture the handlers that registerPtyHandlers installs, so we can invoke them
// directly and assert the dispatch routing without a live Electron IPC channel.
const handlers = new Map<string, (...a: unknown[]) => unknown>();
vi.mock('electron', () => ({
  ipcMain: {
    handle: (ch: string, fn: (...a: unknown[]) => unknown) => handlers.set(ch, (...args) => fn({}, ...args)),
    on: (ch: string, fn: (...a: unknown[]) => unknown) => handlers.set(ch, (...args) => fn({}, ...args)),
  },
  BrowserWindow: class {},
}));

const hostSpawn = vi.fn(async () => ({ success: true, ptyId: 'pty-host' }));
const hostReconnect = vi.fn(() => ({ success: true }));
const hostGetActiveSessions = vi.fn(() => [{ ptyId: 'pty-host', projectPath: '/p', command: '', label: 'host' }]);
const writeToPty = vi.fn();
const resizePty = vi.fn();
const killPty = vi.fn();
const setPtyLabel = vi.fn();
vi.mock('../ptyManager', () => ({
  spawnPty: (...a: unknown[]) => hostSpawn(...(a as [])),
  reconnectPty: (...a: unknown[]) => hostReconnect(...(a as [])),
  getActiveSessions: () => hostGetActiveSessions(),
  setWindow: vi.fn(),
  writeToPty: (...a: unknown[]) => writeToPty(...(a as [])),
  resizePty: (...a: unknown[]) => resizePty(...(a as [])),
  killPty: (...a: unknown[]) => killPty(...(a as [])),
  setPtyLabel: (...a: unknown[]) => setPtyLabel(...(a as [])),
}));

const getSandboxProvider = vi.fn();
vi.mock('../sandbox', () => ({
  getSandboxProvider: (id: unknown) => getSandboxProvider(id),
}));

const window = {} as unknown as Electron.BrowserWindow;

beforeEach(() => {
  vi.clearAllMocks();
  handlers.clear();
  getSandboxProvider.mockReturnValue(undefined);
  registerPtyHandlers(window);
});

describe('pty provider dispatch', () => {
  test('no provider → host spawnPty with no wrapper', async () => {
    const result = await handlers.get('pty:spawn')!({ cwd: '/p' });
    expect(result).toEqual({ success: true, ptyId: 'pty-host' });
    expect(hostSpawn).toHaveBeenCalledWith({ cwd: '/p' }, window, undefined);
  });

  test('a sandbox backend flows through host spawnPty as the wrapper arg', async () => {
    const provider = { id: 'nono' };
    getSandboxProvider.mockReturnValue(provider);
    const options = { cwd: '/p', sandboxProvider: 'nono' };

    await handlers.get('pty:spawn')!(options);
    expect(hostSpawn).toHaveBeenCalledWith(options, window, provider);
  });

  test('per-ptyId ops and active sessions go to the host pty manager', () => {
    handlers.get('pty:write')!('pty-host', 'x');
    expect(writeToPty).toHaveBeenCalledWith('pty-host', 'x');

    handlers.get('pty:resize')!('pty-host', 80, 24);
    expect(resizePty).toHaveBeenCalledWith('pty-host', 80, 24);

    handlers.get('pty:kill')!('pty-host');
    expect(killPty).toHaveBeenCalledWith('pty-host');

    handlers.get('pty:set-label')!('pty-host', 'renamed');
    expect(setPtyLabel).toHaveBeenCalledWith('pty-host', 'renamed');

    handlers.get('pty:reconnect')!('pty-host');
    expect(hostReconnect).toHaveBeenCalledWith('pty-host', window);

    const sessions = handlers.get('pty:get-active-sessions')!() as Array<{ ptyId: string }>;
    expect(sessions.map((s) => s.ptyId)).toEqual(['pty-host']);
  });
});
