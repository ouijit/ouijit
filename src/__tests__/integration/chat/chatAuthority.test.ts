/**
 * What Chat may do through the API, against the real router, database and git,
 * with Chat and a worker on the host replaying a recorded agent.
 */
import { describe, test, expect, vi, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { BrowserWindow } from 'electron';
import { startHookServer, stopHookServer, CLI_REFERENCE } from '../../../hookServer';
import { getApiPort } from '../../../apiPort';
import { getCliReferencePath } from '../../../cliReferencePath';
import { issueToken } from '../../../apiAuth';
import { _resetCacheForTesting, createTask, getTaskByNumber, setGlobalSetting } from '../../../db';
import { chatHost } from '../../../chat/host';
import { homeChatDir, homeChatState, installHomeChat, onHomeChatChange, startHomeChat } from '../../../chat/homeChat';
import { sandboxCliAccessSettingKey } from '../../../sandbox/types';
import { installHomeChatWakes } from '../../../chat/wake';
import { decide, decisions } from '../../../decisions';
import { HOME_CHAT_SETTING_KEYS, taskKey, type HomeChatState } from '../../../chat/preferences';
import type { ChatSnapshot, UserMessageNode } from '../../../chat/model';
import { loadCassette, loadCassettes, replayingSpawn } from './cassette';

vi.mock('../../../ptyManager', () => ({
  getActiveSessions: () => [],
  isPtyActive: () => false,
  callerTerminal: (ptyId: string) => ptyId,
  getPtySpawnContext: () => null,
  getPtyTaskContext: () => null,
}));

const pushes: [string, ...unknown[]][] = [];
const window = {
  isDestroyed: () => false,
  webContents: { send: (channel: string, ...args: unknown[]) => pushes.push([channel, ...args]) },
} as unknown as BrowserWindow;

const CASSETTE = 'home-chat-claude';
const originalPath = process.env.PATH;
let repo: string;
let chat: string;
let token: string;

async function api(method: string, route: string, body?: Record<string, unknown>) {
  const res = await fetch(`http://127.0.0.1:${getApiPort()}/api/${route}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body && { 'Content-Type': 'application/json' }) },
    ...(body && { body: JSON.stringify(body) }),
  });
  const json = (await res.json()) as { data?: Record<string, unknown>; error?: string };
  return { status: res.status, data: json.data, error: json.error };
}

async function until<T>(read: () => T | undefined | null | false, what: string): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() - started > 15_000) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const wakes = (snapshot: ChatSnapshot) =>
  snapshot.nodes.filter((n): n is UserMessageNode => n.kind === 'user_message' && n.wake === true).map((n) => n.text);

beforeAll(async () => {
  _resetCacheForTesting();
  fs.mkdirSync(path.dirname(getCliReferencePath()), { recursive: true });
  fs.writeFileSync(getCliReferencePath(), CLI_REFERENCE);
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-agents-'));
  fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\necho "${loadCassette(CASSETTE).version}"\n`, { mode: 0o755 });
  process.env.PATH = `${bin}:${originalPath}`;
  process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-claude-'));
  chatHost._setOptionsForTesting({ spawnProcess: replayingSpawn(loadCassettes(CASSETTE)) });

  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-chat-authority-')));
  execSync('git init -q && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: repo });
  await createTask(repo, 1, 'Fix auth', { status: 'todo' });
  await createTask(repo, 2, 'Old spike', { status: 'todo' });

  await setGlobalSetting(HOME_CHAT_SETTING_KEYS.agent, 'claude');
  await setGlobalSetting(HOME_CHAT_SETTING_KEYS.sandbox, 'none');
  await setGlobalSetting(
    HOME_CHAT_SETTING_KEYS.wake,
    JSON.stringify({ turnEnded: false, asked: false, taskMoved: true, hookFailed: false }),
  );
  installHomeChatWakes();
  installHomeChat();
  await startHookServer(window);
  const home = await startHomeChat();
  chat = home.info.id;
  await until(() => chatHost.snapshot(chat)?.info.status === 'idle', 'Chat to start');
  token = issueToken(chat, 'host');
});

afterAll(async () => {
  await chatHost.stopAll();
  await stopHookServer();
  process.env.PATH = originalPath;
  delete process.env.CLAUDE_CONFIG_DIR;
});

describe('what Chat can do', () => {
  test('is what where it runs allows, like any session: everything on the host, its CLI access in a sandbox', async () => {
    const project = `project=${encodeURIComponent(repo)}`;

    // On the host it starts a task where it asks to, and the task opens as a chat it owns and follows.
    const started = await api('POST', `tasks/1/start?${project}`, { hookMode: 'run', hookSandbox: 'none' });
    expect(started.status).toBe(200);
    const push = pushes.find(([channel]) => channel === 'cli:task-started')?.[1] as Record<string, unknown>;
    expect(push).toMatchObject({ taskNumber: 1, hookSandbox: 'none', surface: 'chat', fromPtyId: chat });
    expect(push.fromSandbox).toBeUndefined();
    expect((await homeChatState()).owners[taskKey(repo, 1)]).toBe(chat);

    // It follows what it starts, and follows or drops anything else when told to; only Chat follows.
    const followed = async () =>
      ((await api('GET', 'following')).data as unknown as { task: number }[]).map((f) => f.task);
    expect(await followed()).toEqual([1]);
    expect((await api('PUT', `following/tasks/2?${project}`, {})).status).toBe(200);
    expect(await followed()).toEqual([1, 2]);
    // The window hears each change, with what every conversation follows, for the tasks shown above its composer.
    const announced: HomeChatState[] = [];
    const listening = onHomeChatChange((state) => announced.push(state));
    expect((await api('DELETE', `following/tasks/2?${project}`)).status).toBe(200);
    expect(await followed()).toEqual([1]);
    await until(() => announced.at(-1)?.following[chat]?.length === 1, 'the announcement');
    expect(announced.at(-1)!.following[chat]).toEqual([{ projectPath: repo, taskNumber: 1 }]);
    listening();
    expect((await api('PUT', `following/tasks/99?${project}`, {})).status).toBe(404);
    const own = token;
    token = issueToken('pty-not-chat', 'host');
    expect((await api('GET', 'following')).status).toBe(403);
    token = own;

    // Done and trash happen as they would from any terminal; done ends the following, and a move
    // Chat made itself is not news to it.
    expect((await api('PATCH', `tasks/1/status?${project}`, { status: 'done', hookMode: 'run' })).status).toBe(200);
    expect((await getTaskByNumber(repo, 1))?.status).toBe('done');
    expect(
      await until(() => pushes.find(([channel]) => channel === 'cli:task-completed')?.[1], 'the done'),
    ).toMatchObject({
      taskNumber: 1,
      fromPtyId: chat,
    });
    expect(await followed()).toEqual([]);
    expect((await api('DELETE', `tasks/2?${project}`)).status).toBe(200);
    expect(await getTaskByNumber(repo, 2)).toBeFalsy();

    // A command it asks to run on the host waits for the user, and the answer comes back to it.
    const asking = api('POST', 'ask/run', { argv: ['echo', 'from the host'], wait: true });
    const ask = await until(() => decisions().find((d) => d.kind === 'ask'), 'the ask');
    expect(ask).toMatchObject({ from: chat, ask: { command: "echo 'from the host'" } });
    expect(ask.sandboxed).toBeUndefined();
    await decide(ask.id, { kind: 'run' });
    expect((await asking).data).toMatchObject({ status: 'exited', exitCode: 0, output: 'from the host' });
    expect(decisions()).toEqual([]);

    // Sandboxed at Read only, it reads and follows in any project, and moves nothing until widened.
    await createTask(repo, 3, 'Sandboxed', { status: 'todo' });
    token = issueToken(chat, 'sandbox');
    expect((await api('GET', `tasks?${project}`)).status).toBe(200);
    expect((await api('GET', 'terminals')).status).toBe(200);
    expect((await api('PUT', `following/tasks/3?${project}`, {})).status).toBe(200);
    expect(await followed()).toEqual([3]);
    expect((await api('DELETE', `following/tasks/3?${project}`)).status).toBe(200);
    expect((await api('POST', `tasks/3/start?${project}`, { hookMode: 'run' })).status).toBe(403);
    expect((await api('PATCH', `tasks/3/status?${project}`, { status: 'in_review' })).status).toBe(403);
    expect((await api('POST', `chats/${chat}/messages`, { text: 'hi' })).status).toBe(403);
    await setGlobalSetting(sandboxCliAccessSettingKey(homeChatDir()), 'all');
    expect((await api('GET', `tasks?${project}`)).status).toBe(200);
    expect((await api('POST', `tasks/3/start?${project}`, { hookMode: 'run' })).status).toBe(200);
    token = own;

    // Nor is any of this news to it: every move here was its own.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(wakes(chatHost.snapshot(chat)!)).toEqual([]);
  });
});
