import { test, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { BrowserWindow } from 'electron';
import { startHookServer, stopHookServer } from '../../../hookServer';
import { getApiPort } from '../../../apiPort';
import { issueToken } from '../../../apiAuth';
import { chatHost } from '../../../chat/host';
import { _resetCacheForTesting } from '../../../db';
import type { ChatSessionInfo, RequestNode } from '../../../chat/model';
import { loadCassettes, replayingSpawn } from './cassette';

const window = { isDestroyed: () => false, webContents: { send: () => undefined } } as unknown as BrowserWindow;
const originalPath = process.env.PATH;

beforeAll(async () => {
  _resetCacheForTesting();
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-agents-'));
  fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\necho "2.1.316"\n', { mode: 0o755 });
  process.env.PATH = `${bin}:${originalPath}`;
  process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-claude-'));
  await startHookServer(window);
});

afterAll(async () => {
  process.env.PATH = originalPath;
  delete process.env.CLAUDE_CONFIG_DIR;
  await stopHookServer();
});

async function get<T>(token: string, url: string): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${getApiPort()}${url}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return ((await response.json()) as { data: T }).data;
}

async function until(id: string, done: (info: ChatSessionInfo) => boolean): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 20_000) {
    const snapshot = chatHost.snapshot(id);
    if (snapshot && done(snapshot.info)) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('timed out');
}

test('a chat whose turn ended with work still running in the background lists as working until that work ends', async () => {
  chatHost._setOptionsForTesting({ spawnProcess: replayingSpawn(loadCassettes('claude-background')) });
  const unsubscribe = chatHost.subscribe((sessionId, { event }) => {
    if (event.type !== 'node' || event.node.kind !== 'request' || event.node.status !== 'pending') return;
    const request = event.node as RequestNode;
    const allow = request.options.find((option) => option.kind === 'allow_once') ?? request.options[0];
    setImmediate(() => chatHost.answer(sessionId, request.id, { kind: 'option', optionId: allow.id }));
  });
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-background-')));
  execFileSync('git', ['init', '-q'], { cwd });
  const id = 'pty-background-status';
  await chatHost.start({ id, agent: 'claude', projectPath: cwd, cwd, taskId: null });
  const cli = issueToken('pty-cli', 'host');
  const listed = async () =>
    (await get<{ sessionId: string; agentStatus: string | null; background?: number }[]>(cli, '/api/terminals')).find(
      (session) => session.sessionId === id,
    );

  await chatHost.prompt(id, {
    text: 'First use your Bash tool, in the foreground, to run: sleep 8 && echo ready. Then use your Bash tool with run_in_background set to true to run: sleep 600. Do not wait for it. Then reply with only: started',
  });
  await until(id, (info) => info.status === 'idle' && (info.background ?? []).some((task) => task.kind === 'shell'));

  // The turn is over, but the shell it left is not: the CLI lists it as working, and chat read names the shell.
  expect(await listed()).toMatchObject({ agentStatus: 'thinking', background: 1 });
  const read = await get<{ info: ChatSessionInfo }>(cli, `/api/chats/${id}`);
  const shell = read.info.background!.find((task) => task.kind === 'shell')!;
  expect(shell.description).toBeTruthy();

  await chatHost.stopBackground(id, shell.id);
  await until(id, (info) => !(info.background ?? []).some((task) => task.id === shell.id));
  // The recording ends there, so the agent may have gone too; either way it is no longer working.
  const done = await listed();
  expect(done?.agentStatus).not.toBe('thinking');
  expect(done?.background).toBeUndefined();

  unsubscribe();
  await chatHost.stop(id);
});
