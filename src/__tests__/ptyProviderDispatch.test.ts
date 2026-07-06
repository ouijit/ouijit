import { describe, test, expect, vi, beforeEach } from 'vitest';

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
const findSessionOwner = vi.fn();
const listSessionOwners = vi.fn();
vi.mock('../sandbox', () => ({
  getSandboxProvider: (id: unknown) => getSandboxProvider(id),
  findSessionOwner: (id: unknown) => findSessionOwner(id),
  listSessionOwners: () => listSessionOwners(),
}));

import { registerPtyHandlers } from '../ipc/handlers/pty';

const window = {} as unknown as Electron.BrowserWindow;

function makeSessionOwner() {
  return {
    kind: 'session-owner' as const,
    spawnPty: vi.fn(async () => ({ success: true, ptyId: 'pty-sandbox-1' })),
    ownsPty: (id: string) => id.startsWith('pty-sandbox'),
    writePty: vi.fn(),
    resizePty: vi.fn(),
    killPty: vi.fn(),
    setPtyLabel: vi.fn(),
    reconnectPty: vi.fn(() => ({ success: true, bufferedOutput: 'sb' })),
    getActiveSessions: vi.fn(() => [{ ptyId: 'pty-sandbox-1', projectPath: '/p', command: '', label: 'sb' }]),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  handlers.clear();
  getSandboxProvider.mockReturnValue(undefined);
  findSessionOwner.mockReturnValue(undefined);
  listSessionOwners.mockReturnValue([]);
  registerPtyHandlers(window);
});

describe('pty provider dispatch', () => {
  test('no provider → host spawnPty (2 args, no wrapper)', async () => {
    const result = await handlers.get('pty:spawn')!({ cwd: '/p' });
    expect(result).toEqual({ success: true, ptyId: 'pty-host' });
    expect(hostSpawn).toHaveBeenCalledTimes(1);
    expect(hostSpawn.mock.calls[0]).toHaveLength(2); // options, window — no wrapper
  });

  test('session-owner provider takes full custody of the spawn', async () => {
    const owner = makeSessionOwner();
    getSandboxProvider.mockReturnValue(owner);
    const options = { cwd: '/p', sandboxProvider: 'lima' };

    const result = await handlers.get('pty:spawn')!(options);
    expect(owner.spawnPty).toHaveBeenCalledWith(options, window);
    expect(hostSpawn).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, ptyId: 'pty-sandbox-1' });
  });

  test('wrapper provider flows through host spawnPty with itself as the wrapper arg', async () => {
    const wrapper = { kind: 'wrapper' as const };
    getSandboxProvider.mockReturnValue(wrapper);
    const options = { cwd: '/p', sandboxProvider: 'nono' };

    await handlers.get('pty:spawn')!(options);
    expect(hostSpawn).toHaveBeenCalledWith(options, window, wrapper);
  });

  test('per-ptyId ops route to the owning session-owner, else the host', () => {
    const owner = makeSessionOwner();
    findSessionOwner.mockImplementation((id: string) => (id.startsWith('pty-sandbox') ? owner : undefined));

    handlers.get('pty:write')!('pty-sandbox-1', 'x');
    expect(owner.writePty).toHaveBeenCalledWith('pty-sandbox-1', 'x');
    expect(writeToPty).not.toHaveBeenCalled();

    handlers.get('pty:write')!('pty-host', 'y');
    expect(writeToPty).toHaveBeenCalledWith('pty-host', 'y');

    handlers.get('pty:kill')!('pty-sandbox-1');
    expect(owner.killPty).toHaveBeenCalledWith('pty-sandbox-1');

    handlers.get('pty:reconnect')!('pty-sandbox-1');
    expect(owner.reconnectPty).toHaveBeenCalledWith('pty-sandbox-1', window);
  });

  test('get-active-sessions merges host sessions with every session-owner', () => {
    const owner = makeSessionOwner();
    listSessionOwners.mockReturnValue([owner]);

    const sessions = handlers.get('pty:get-active-sessions')!() as Array<{ ptyId: string }>;
    expect(sessions.map((s) => s.ptyId)).toEqual(['pty-host', 'pty-sandbox-1']);
  });
});
