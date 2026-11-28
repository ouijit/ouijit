import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import { Command } from 'commander';
import type { BrowserWindow } from 'electron';

import { registerTerminalCommands } from '../../../cli/commands/terminal';
import { registerSessionCommands } from '../../../cli/commands/session';
import { registerPanelCommands } from '../../../cli/commands/panel';
import { registerDiffCommands } from '../../../cli/commands/diff';
import { startHookServer, stopHookServer } from '../../../hookServer';
import { getApiPort } from '../../../apiPort';
import { issueToken, revokeAllTokens } from '../../../apiAuth';
import { initCliPanels } from '../../../cliPanels';
import type { ActiveSession, CliPanelOp, CliPanelResponse, CliTerminalOp, CliTerminalResponse } from '../../../types';

const { ipcHandlers, sessions, renderer } = vi.hoisted(() => ({
  ipcHandlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  sessions: [] as ActiveSession[],
  renderer: { terminalOps: [] as unknown[], panelOps: [] as unknown[] },
}));

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/test', isReady: () => true, getLocale: () => 'en-US' },
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => ipcHandlers.set(channel, fn),
  },
}));

// Live PTYs need a spawned shell; these records stand in for the open ones.
vi.mock('../../../ptyManager', () => ({
  getActiveSessions: () => sessions,
  isPtyActive: (ptyId: string) => sessions.some((s) => s.ptyId === ptyId),
  getPtyTaskContext: () => null,
  callerTerminal: (ptyId: string) => ptyId,
  getPtySpawnContext: () => null,
}));

/**
 * The renderer end of the bridge, answering each push on its respond channel
 * as the window's listeners do: an open adds a session, a paste with a
 * newline is refused as a program without bracketed paste refuses it.
 */
function fakeRendererWindow(): BrowserWindow {
  const answerTerminal = (op: CliTerminalOp): CliTerminalResponse => {
    renderer.terminalOps.push(op);
    if (op.action === 'open') {
      sessions.push({
        ptyId: 'pty-new',
        projectPath: op.projectPath!,
        command: 'zsh',
        label: 'Shell',
        taskId: op.taskNumber,
      });
      return { ok: true, ptyId: 'pty-new' };
    }
    if (op.action === 'paste' && op.text?.includes('\n')) return { ok: false, error: 'send one line' };
    if (op.action === 'read') return { ok: true, ptyId: op.ptyId, text: '3 failing', alternateScreen: false };
    return { ok: true, ptyId: op.ptyId };
  };
  const answerPanel = (op: CliPanelOp): CliPanelResponse => {
    renderer.panelOps.push(op);
    return { ok: true, panels: [], diffOpen: op.action === 'diff-open' };
  };
  return {
    isDestroyed: () => false,
    webContents: {
      send: (channel: string, op: CliTerminalOp & CliPanelOp) => {
        if (channel !== 'cli:terminal-op' && channel !== 'cli:panel-op') return;
        const reply =
          channel === 'cli:terminal-op'
            ? ['cli-terminals:respond', answerTerminal(op)]
            : ['cli-panels:respond', answerPanel(op)];
        setImmediate(() => ipcHandlers.get(reply[0] as string)!({}, op.requestId, reply[1]));
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
  registerSessionCommands(program, async () => '/p');
  registerTerminalCommands(program, async () => '/p');
  registerPanelCommands(program);
  registerDiffCommands(program, async () => '/p');
  try {
    await program.parseAsync(args, { from: 'user' });
  } finally {
    spy.mockRestore();
  }
  return JSON.parse(chunks.join(''));
}

beforeEach(async () => {
  revokeAllTokens();
  sessions.splice(0, sessions.length, {
    ptyId: 'pty-a',
    projectPath: '/p',
    command: 'zsh',
    label: 'claude',
    taskId: 4,
  });
  renderer.terminalOps = [];
  renderer.panelOps = [];
  const window = fakeRendererWindow();
  initCliPanels(window);
  await startHookServer(window);
  vi.stubEnv('OUIJIT_API_URL', `http://127.0.0.1:${getApiPort()}`);
  vi.stubEnv('OUIJIT_API_TOKEN', issueToken('pty-a', 'host'));
  vi.stubEnv('OUIJIT_SESSION_ID', 'pty-a');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await stopHookServer();
});

describe('ouijit session', () => {
  test('lists, reads, pastes into and closes sessions, opens a terminal, and only from the host', async () => {
    expect(await ouijit('session', 'list', '--task', '4')).toEqual([
      expect.objectContaining({ sessionId: 'pty-a', kind: 'terminal', taskNumber: 4, sandbox: 'host' }),
    ]);
    expect(await ouijit('session', 'list', '--task', '5')).toEqual([]);
    expect(await ouijit('session', 'read', 'pty-a', '--lines', '40')).toEqual({
      sessionId: 'pty-a',
      text: '3 failing',
      alternateScreen: false,
    });
    expect(await ouijit('session', 'paste', 'pty-a', 'run the tests again')).toEqual({
      sessionId: 'pty-a',
      pasted: true,
    });
    await expect(ouijit('session', 'paste', 'pty-a', 'one\ntwo')).rejects.toThrow(/send one line/);

    expect(await ouijit('terminal', 'open', '--task', '4', '--resume', '--sandbox', 'host')).toEqual(
      expect.objectContaining({ sessionId: 'pty-new', projectPath: '/p', taskNumber: 4 }),
    );
    expect(await ouijit('session', 'close', 'pty-new')).toEqual({ sessionId: 'pty-new', closed: true });
    expect(renderer.terminalOps).toEqual([
      expect.objectContaining({ action: 'read', ptyId: 'pty-a', lines: 40 }),
      expect.objectContaining({ action: 'paste', text: 'run the tests again' }),
      expect.objectContaining({ action: 'paste', text: 'one\ntwo' }),
      expect.objectContaining({ action: 'open', projectPath: '/p', taskNumber: 4, resume: true, sandbox: 'none' }),
      expect.objectContaining({ action: 'close', ptyId: 'pty-new' }),
    ]);
    await expect(ouijit('session', 'read', 'pty-gone')).rejects.toThrow(/not found/);

    // A sandbox reads its own screen; another session's, and typing into any, are the host's.
    vi.stubEnv('OUIJIT_API_TOKEN', issueToken('pty-a', 'sandbox'));
    expect(await ouijit('session', 'read', 'pty-a')).toEqual(expect.objectContaining({ sessionId: 'pty-a' }));
    await expect(ouijit('session', 'read', 'pty-new')).rejects.toThrow(/Forbidden/);
    await expect(ouijit('session', 'paste', 'pty-a', 'hi')).rejects.toThrow(/Forbidden/);
  });
});

describe('ouijit panel and diff', () => {
  test("open every kind of panel, then focus and close them, on this terminal's card unless another is named", async () => {
    sessions.push({ ptyId: 'pty-b', projectPath: '/p', command: 'zsh', label: 'Shell' } as ActiveSession);
    await ouijit('panel', 'open', 'markdown', 'notes/plan.md');
    await ouijit('panel', 'open', 'browser', 'http://localhost:3000', 'pty-b');
    await ouijit('panel', 'open', 'script', 'Dev server');
    await ouijit('panel', 'open', 'shell');
    await ouijit('panel', 'list');
    await ouijit('panel', 'focus', 'panel-2', 'pty-a');
    await ouijit('panel', 'hide');
    await ouijit('panel', 'close', 'panel-2');
    expect(await ouijit('diff', 'open')).toEqual({ sessionId: 'pty-a', panels: [], diffOpen: true });
    await ouijit('diff', 'close');

    expect(renderer.panelOps.map((op) => (({ requestId: _, ...rest }) => rest)(op as CliPanelOp))).toEqual([
      { ptyId: 'pty-a', action: 'add', kind: 'markdown', value: path.resolve('notes/plan.md') },
      { ptyId: 'pty-b', action: 'add', kind: 'browser', value: 'http://localhost:3000' },
      { ptyId: 'pty-a', action: 'add', kind: 'runner', value: 'Dev server' },
      expect.objectContaining({ ptyId: 'pty-a', action: 'add', kind: 'runner', shell: true }),
      { ptyId: 'pty-a', action: 'list-all' },
      { ptyId: 'pty-a', action: 'focus', value: 'panel-2' },
      { ptyId: 'pty-a', action: 'hide' },
      { ptyId: 'pty-a', action: 'close', value: 'panel-2' },
      { ptyId: 'pty-a', action: 'diff-open' },
      { ptyId: 'pty-a', action: 'diff-close' },
    ]);
  });
});
