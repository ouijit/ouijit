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
import { _resetCacheForTesting, createTask, getChatRepo, setGlobalSetting } from '../../../db';
import { chatHost } from '../../../chat/host';
import { homeChatDir, installHomeChat, startHomeChat } from '../../../chat/homeChat';
import { sandboxCliAccessSettingKey } from '../../../sandbox/types';
import { HOME_CHAT_SETTING_KEYS } from '../../../chat/preferences';
import { CONTINUATION_BUDGET_CHARS } from '../../../chat/continuation';
import type { ChatNode } from '../../../chat/model';
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

/** A task chat as Ouijit stored it once its agent had gone. */
function storedChat(id: string, taskId: number, nodes: ChatNode[]): void {
  const now = new Date().toISOString();
  const cwd = path.join(repo, 'wt');
  const info = { id, role: 'card', agent: 'claude', projectPath: repo, cwd, worktreePath: cwd, sandbox: null, taskId };
  getChatRepo().save(
    {
      id,
      project_path: repo,
      task_id: taskId,
      cwd,
      worktree_path: cwd,
      agent: 'claude',
      agent_session_id: null,
      sandbox: null,
      role: 'card',
      info: JSON.stringify({ ...info, status: 'exited' }),
      seq: 0,
      created_at: now,
      updated_at: now,
    },
    nodes.map((node, position) => ({ nodeId: node.id, position, body: JSON.stringify(node) })),
    [],
  );
}

const said = (id: string, kind: 'user_message' | 'assistant_message', text: string): ChatNode =>
  kind === 'user_message'
    ? { id, kind, parentId: null, createdAt: 0, text, attachments: [], delivery: 'prompt' }
    : { id, kind, parentId: null, createdAt: 0, text };

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
  vi.stubEnv('OUIJIT_SESSION_ID', chat);
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
    expect(result).toMatchObject({ sessionId: 'pty-chat-new', taskNumber: 2 });
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

    // From a sandbox at View it is the host's, as opening a terminal is.
    await setGlobalSetting(sandboxCliAccessSettingKey(homeChatDir()), 'read');
    vi.stubEnv('OUIJIT_API_TOKEN', issueToken(chat, 'sandbox'));
    await expect(ouijit('chat', 'open', '--task', '2')).rejects.toThrow(/Forbidden/);
    expect(opened).toHaveLength(1);
  });

  test('opens a chat that carries on another chat of the task, trimmed to its most recent part', async () => {
    vi.stubEnv('OUIJIT_API_TOKEN', issueToken(chat, 'host'));
    await createTask(repo, 3, 'Other work', {
      status: 'in_progress',
      branch: 'T-3',
      worktreePath: path.join(repo, 'wt3'),
    });
    storedChat('pty-earlier', 2, [
      said('u1', 'user_message', 'the login times out after a minute'),
      said('a1', 'assistant_message', 'The session timeout is hardcoded in auth.ts; I will make it configurable.'),
      {
        id: 't1',
        kind: 'tool_call',
        parentId: null,
        createdAt: 0,
        tool: 'execute',
        name: 'Bash',
        title: 'npm test',
        input: {},
        command: 'npm test',
        output: 'FAIL auth.test.ts\n'.repeat(50),
        exitCode: 1,
        files: [],
        status: 'failed',
      },
    ]);
    storedChat('pty-other-task', 3, [said('o1', 'user_message', 'something else')]);
    const long = Array.from({ length: 12 }, (_, i) =>
      said(`l${i}`, 'assistant_message', `step ${i} ${'x'.repeat(CONTINUATION_BUDGET_CHARS / 10)}`),
    );
    storedChat('pty-long', 2, long);

    const firstMessage = async (...args: string[]) => {
      await ouijit('chat', 'open', '--task', '2', ...args);
      return opened.at(-1)!.chat!.prompt!;
    };

    const seeded = await firstMessage('--from', 'pty-earlier', '--prompt', 'now add a test for it', '--agent', 'pi');
    expect(seeded).toContain('task 2, "Fix auth", in this same worktree');
    expect(seeded).toContain(
      '> the login times out after a minute\n\nThe session timeout is hardcoded in auth.ts; I will make it configurable.\n\n[failed] npm test',
    );
    // A tool step is a line, not its output.
    expect(seeded).not.toContain('FAIL auth.test.ts');
    expect(seeded).not.toContain('were left out');
    expect(seeded.endsWith('now add a test for it')).toBe(true);
    expect(opened.at(-1)!.chat!.agent).toBe('pi');

    const trimmed = await firstMessage('--from', 'pty-long');
    expect(trimmed).toContain('Earlier parts of the conversation were left out');
    expect(trimmed).toContain('step 11 ');
    expect(trimmed).not.toContain('step 0 ');
    expect(trimmed.length).toBeLessThan(CONTINUATION_BUDGET_CHARS + 1_000);

    const before = opened.length;
    await expect(ouijit('chat', 'open', '--task', '2', '--from', 'pty-other-task')).rejects.toThrow(
      /Chat pty-other-task is not on task 2/,
    );
    await expect(ouijit('chat', 'open', '--task', '2', '--from', 'pty-missing')).rejects.toThrow(
      /Chat pty-missing not found/,
    );
    expect(opened).toHaveLength(before);
  });
});
