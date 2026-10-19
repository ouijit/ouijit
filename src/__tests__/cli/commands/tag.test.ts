import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import type { BrowserWindow } from 'electron';

import { registerTagCommands } from '../../../cli/commands/tag';
import { startHookServer, stopHookServer, getApiPort } from '../../../hookServer';
import { issueToken, revokeAllTokens } from '../../../apiAuth';
import { initCliPanels } from '../../../cliPanels';
import type { CliTagOp, CliTagResponse } from '../../../types';

const { ipcHandlers } = vi.hoisted(() => ({
  ipcHandlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
}));

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/test', isReady: () => true, getLocale: () => 'en-US' },
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => ipcHandlers.set(channel, fn),
  },
}));

// Live PTYs need a spawned shell; these two stand in for open terminals.
vi.mock('../../../ptyManager', () => ({
  isPtyActive: (ptyId: string) => ptyId === 'pty-a' || ptyId === 'pty-b',
  getPtyTaskContext: () => null,
}));

/**
 * The renderer end of the bridge: answers each `cli:tag-op` push on
 * `cli-tags:respond`, as the window's listener does, keeping one tag per terminal.
 */
function fakeRendererWindow(): BrowserWindow {
  const tags = new Map<string, string[]>([
    ['pty-a', []],
    ['pty-b', []],
  ]);
  const answer = (op: CliTagOp): CliTagResponse => {
    if (op.action === 'list') {
      const names = [...new Set([...tags.values()].flat())];
      return {
        ok: true,
        listing: names.map((name) => ({
          name,
          terminals: [...tags]
            .filter(([, t]) => t.includes(name))
            .map(([ptyId]) => ({ ptyId, label: ptyId, projectPath: '/p' })),
        })),
      };
    }
    if (op.action === 'set') tags.set(op.ptyId!, [op.tag!]);
    if (op.action === 'clear') tags.set(op.ptyId!, []);
    return { ok: true, tags: tags.get(op.ptyId!) };
  };
  return {
    isDestroyed: () => false,
    webContents: {
      send: (channel: string, op: CliTagOp) => {
        if (channel !== 'cli:tag-op') return;
        setImmediate(() => ipcHandlers.get('cli-tags:respond')!({}, op.requestId, answer(op)));
      },
    },
  } as unknown as BrowserWindow;
}

async function ouijit(...args: string[]): Promise<unknown> {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((data) => {
    chunks.push(String(data));
    return true;
  });
  const program = new Command();
  program.exitOverride();
  registerTagCommands(program);
  try {
    await program.parseAsync(['tag', ...args], { from: 'user' });
  } finally {
    spy.mockRestore();
  }
  return JSON.parse(chunks.join(''));
}

beforeEach(async () => {
  revokeAllTokens();
  const window = fakeRendererWindow();
  initCliPanels(window);
  await startHookServer(window);
  vi.stubEnv('OUIJIT_API_URL', `http://127.0.0.1:${getApiPort()}`);
  vi.stubEnv('OUIJIT_API_TOKEN', issueToken('pty-a', 'host'));
  vi.stubEnv('OUIJIT_PTY_ID', 'pty-a');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await stopHookServer();
});

describe('ouijit tag', () => {
  test('sets, reads and clears the tag on the terminal it runs in, or on one it names', async () => {
    expect(await ouijit('get')).toEqual({ ptyId: 'pty-a', tags: [] });
    expect(await ouijit('set', 'review')).toEqual({ ptyId: 'pty-a', tags: ['review'] });
    expect(await ouijit('set', 'blocked', 'pty-b')).toEqual({ ptyId: 'pty-b', tags: ['blocked'] });
    expect(await ouijit('get')).toEqual({ ptyId: 'pty-a', tags: ['review'] });

    expect(await ouijit('list')).toEqual([
      { name: 'review', terminals: [expect.objectContaining({ ptyId: 'pty-a' })] },
      { name: 'blocked', terminals: [expect.objectContaining({ ptyId: 'pty-b' })] },
    ]);

    expect(await ouijit('clear')).toEqual({ ptyId: 'pty-a', tags: [] });
    await expect(ouijit('get', 'pty-gone')).rejects.toThrow(/not found/);
  });
});
