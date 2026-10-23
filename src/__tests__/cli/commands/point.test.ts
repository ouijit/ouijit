import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import { Command } from 'commander';
import type { BrowserWindow } from 'electron';

import { registerPointCommands } from '../../../cli/commands/point';
import { startHookServer, stopHookServer, getApiPort } from '../../../hookServer';
import { issueToken, revokeAllTokens } from '../../../apiAuth';
import { initCliPanels } from '../../../cliPanels';
import type { CliPointOp, CliPointResponse } from '../../../types';

const { ipcHandlers, ops } = vi.hoisted(() => ({
  ipcHandlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  ops: [] as Omit<CliPointOp, 'requestId'>[],
}));

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/test', isReady: () => true, getLocale: () => 'en-US' },
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => ipcHandlers.set(channel, fn),
  },
}));

// A live PTY needs a spawned shell; this one stands in for the agent's terminal.
vi.mock('../../../ptyManager', () => ({
  isPtyActive: (ptyId: string) => ptyId === 'pty-agent',
  getPtyTaskContext: () => ({ projectPath: '/p', taskId: 4 }),
  getPtySpawnContext: () => null,
  getActiveSessions: () => [],
}));

/** The renderer end, keeping each terminal's pointer as the listener does and refusing a task it doesn't know. */
function fakeRendererWindow(): BrowserWindow {
  const answer = ({ requestId: _, ...op }: CliPointOp): CliPointResponse => {
    ops.push(op);
    if (op.target?.kind === 'task' && op.target.taskNumber === 99) return { ok: false, error: 'Task 99 not found' };
    return { ok: true, target: op.target };
  };
  return {
    isDestroyed: () => false,
    webContents: {
      send: (channel: string, op: CliPointOp) => {
        if (channel !== 'cli:point-op') return;
        setImmediate(() => ipcHandlers.get('cli-points:respond')!({}, op.requestId, answer(op)));
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
  registerPointCommands(program, () => '/p');
  try {
    await program.parseAsync(['point', ...args], { from: 'user' });
  } finally {
    spy.mockRestore();
  }
  return JSON.parse(chunks.join(''));
}

beforeEach(async () => {
  revokeAllTokens();
  ops.length = 0;
  const window = fakeRendererWindow();
  initCliPanels(window);
  await startHookServer(window);
  vi.stubEnv('OUIJIT_API_URL', `http://127.0.0.1:${getApiPort()}`);
  vi.stubEnv('OUIJIT_PTY_ID', 'pty-agent');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await stopHookServer();
});

describe('ouijit point', () => {
  test('points from the terminal it runs in, even a sandboxed one, at anything it can name', async () => {
    vi.stubEnv('OUIJIT_API_TOKEN', issueToken('pty-agent', 'sandbox'));

    await ouijit('task', '14');
    await ouijit('terminal', 'pty-b');
    await ouijit('board');
    await ouijit('pr', '212');
    await ouijit('issue', 'ENG-231');
    await ouijit('panel', 'panel-2');
    expect(await ouijit('diff', 'src/auth.ts:88', 'pty-b')).toEqual({
      target: { kind: 'diff', ptyId: 'pty-b', path: path.resolve('src/auth.ts'), line: 88 },
    });
    await ouijit('note', 'n-1');
    expect(await ouijit('clear')).toEqual({ cleared: true });

    expect(ops.map(({ action, target, noteId }) => [action, target ?? noteId ?? null])).toEqual([
      ['point', { kind: 'task', projectPath: '/p', taskNumber: 14 }],
      ['point', { kind: 'terminal', ptyId: 'pty-b' }],
      ['point', { kind: 'board', projectPath: '/p' }],
      ['point', { kind: 'pr', projectPath: '/p', number: 212 }],
      ['point', { kind: 'issue', projectPath: '/p', id: 'ENG-231' }],
      ['point', { kind: 'panel', ptyId: 'pty-agent', panelId: 'panel-2' }],
      ['point', { kind: 'diff', ptyId: 'pty-b', path: path.resolve('src/auth.ts'), line: 88 }],
      ['note', 'n-1'],
      ['clear', null],
    ]);
    expect(ops.every((op) => op.fromPtyId === 'pty-agent')).toBe(true);

    await expect(ouijit('task', '99')).rejects.toThrow(/Task 99 not found/);
  });
});
