/**
 * `ouijit chat open`: a new chat on a task already under way, opened through
 * the same renderer path as the task menu's New chat, and followed by Chat
 * when Chat is the one asking.
 */
import { describe, test, expect, vi, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { Command } from 'commander';
import type { BrowserWindow } from 'electron';
import { registerChatCommands } from '../../../cli/commands/chat';
import { startHookServer, stopHookServer, CLI_REFERENCE } from '../../../hookServer';
import { getApiPort } from '../../../apiPort';
import { getCliReferencePath } from '../../../cliReferencePath';
import { initCliPanels } from '../../../cliPanels';
import { issueToken } from '../../../apiAuth';
import { _resetCacheForTesting, createTask, setGlobalSetting } from '../../../db';
import { chatHost } from '../../../chat/host';
import { installHomeChat, startHomeChat } from '../../../chat/homeChat';
import { HOME_CHAT_SETTING_KEYS } from '../../../chat/preferences';
import type { ActiveSession } from '../../../ptyManager';
import type { CliTerminalOp, CliTerminalResponse } from '../../../types';
import { loadCassette, loadCassettes, replayingSpawn } from './cassette';

const { ipcHandlers, sessions, dataDir } = vi.hoisted(() => ({
  ipcHandlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  sessions: [] as ActiveSession[],
  dataDir: { path: '' },
}));

// The integration setup's Electron has no ipcMain; the renderer answers ops through it here.
vi.mock('electron', () => ({
  app: { getPath: () => dataDir.path, isReady: () => true, getLocale: () => 'en-US' },
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => ipcHandlers.set(channel, fn),
  },
  safeStorage: { isEncryptionAvailable: () => false },
}));

// The chat the renderer opens runs as a card session on its task, as a real one would.
vi.mock('../../../ptyManager', () => ({
  getActiveSessions: () => sessions,
  isPtyActive: (ptyId: string) => sessions.some((s) => s.ptyId === ptyId),
  callerTerminal: (ptyId: string) => ptyId,
  getPtySpawnContext: () => null,
  getPtyTaskContext: (ptyId: string) => {
    const session = sessions.find((s) => s.ptyId === ptyId);
    return session?.taskId != null ? { projectPath: session.projectPath, taskId: session.taskId } : null;
  },
}));

const CASSETTE = 'home-chat-claude';
const originalPath = process.env.PATH;
const opened: CliTerminalOp[] = [];
let repo: string;
let chat: string;

/** The renderer end: an open with chat options becomes a chat card on the task. */
const window = {
  isDestroyed: () => false,
  webContents: {
    send: (channel: string, op: CliTerminalOp) => {
      if (channel !== 'cli:terminal-op') return;
      opened.push(op);
      sessions.push({
        ptyId: 'pty-chat-new',
        projectPath: op.projectPath!,
        command: '',
        label: 'Chat',
        taskId: op.taskNumber,
      });
      const reply: CliTerminalResponse = { ok: true, ptyId: 'pty-chat-new' };
      setImmediate(() => ipcHandlers.get('cli-terminals:respond')!({}, op.requestId, reply));
    },
  },
} as unknown as BrowserWindow;

async function ouijit(...args: string[]): Promise<unknown> {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((data) => {
    chunks.push(String(data));
    return true;
  });
  const program = new Command();
  program.exitOverride();
  registerChatCommands(program, async () => repo);
  try {
    await program.parseAsync(args, { from: 'user' });
  } finally {
    spy.mockRestore();
  }
  return JSON.parse(chunks.join(''));
}

beforeAll(async () => {
  dataDir.path = fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-chat-open-data-'));
  _resetCacheForTesting();
  fs.mkdirSync(path.dirname(getCliReferencePath()), { recursive: true });
  fs.writeFileSync(getCliReferencePath(), CLI_REFERENCE);
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-agents-'));
  fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\necho "${loadCassette(CASSETTE).version}"\n`, { mode: 0o755 });
  process.env.PATH = `${bin}:${originalPath}`;
  process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-claude-'));
  chatHost._setOptionsForTesting({ spawnProcess: replayingSpawn(loadCassettes(CASSETTE)) });

  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-chat-open-')));
  execSync('git init -q && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: repo });
  await createTask(repo, 1, 'Not yet begun', { status: 'todo' });
  await createTask(repo, 2, 'Fix auth', { status: 'in_progress', branch: 'T-2', worktreePath: path.join(repo, 'wt') });

  await setGlobalSetting(HOME_CHAT_SETTING_KEYS.agent, 'claude');
  await setGlobalSetting(HOME_CHAT_SETTING_KEYS.sandbox, 'none');
  installHomeChat();
  initCliPanels(window);
  await startHookServer(window);
  chat = (await startHomeChat()).info.id;
  for (let i = 0; i < 300 && chatHost.snapshot(chat)?.info.status !== 'idle'; i++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  vi.stubEnv('OUIJIT_API_URL', `http://127.0.0.1:${getApiPort()}`);
  vi.stubEnv('OUIJIT_PTY_ID', chat);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await chatHost.stopAll();
  await stopHookServer();
  process.env.PATH = originalPath;
  delete process.env.CLAUDE_CONFIG_DIR;
});

describe('ouijit chat open', () => {
  test('opens a new chat on a started task with its first message, Chat follows it, and only the host may', async () => {
    vi.stubEnv('OUIJIT_API_TOKEN', issueToken(chat, 'host'));

    // Only a task already under way has a worktree to open it in.
    await expect(ouijit('chat', 'open', '--task', '1')).rejects.toThrow(
      /Task 1 is not started; start it with ouijit task start/,
    );
    await expect(ouijit('chat', 'open', '--task', '9')).rejects.toThrow(/Task 9 not found/);
    await expect(ouijit('chat', 'open', '--task', '2', '--agent', 'gpt')).rejects.toThrow(/Invalid agent: gpt/);
    expect(opened).toEqual([]);

    const stdin = vi
      .spyOn(process, 'stdin', 'get')
      .mockReturnValue(Readable.from(['add tests for the timeout\n']) as never);
    const result = await ouijit(
      'chat',
      'open',
      '--task',
      '2',
      '--prompt',
      '-',
      '--agent',
      'codex',
      '--sandbox',
      'host',
    );
    stdin.mockRestore();
    expect(result).toMatchObject({ ptyId: 'pty-chat-new', taskNumber: 2 });
    expect(opened).toEqual([
      expect.objectContaining({
        action: 'open',
        projectPath: repo,
        taskNumber: 2,
        sandbox: 'none',
        chat: { agent: 'codex', prompt: 'add tests for the timeout' },
      }),
    ]);
    // Chat hears what happens on the task its new chat works on.
    expect(await ouijit('chat', 'following')).toEqual([expect.objectContaining({ task: 2, name: 'Fix auth' })]);

    // From a sandbox it is the host's, as opening a terminal is, until the access setting widens it.
    vi.stubEnv('OUIJIT_API_TOKEN', issueToken(chat, 'sandbox'));
    await expect(ouijit('chat', 'open', '--task', '2')).rejects.toThrow(/Forbidden/);
    expect(opened).toHaveLength(1);
  });
});
