import { describe, test, expect, vi, beforeAll, afterAll } from 'vitest';
import * as http from 'node:http';
import type { BrowserWindow } from 'electron';

import { startHookServer, stopHookServer, getApiPort } from '../hookServer';
import { issueToken } from '../apiAuth';
import { typedPush } from '../ipc/helpers';
import { registerSandboxProviders } from '../sandbox';
import { setCustomSandboxConfig } from '../sandbox/custom/config';

const TASK = { projectPath: '/Users/dev/code/proj', taskId: 3, worktreePath: '/Users/dev/wt/T-3' };

vi.mock('../ptyManager', () => ({
  isPtyActive: () => true,
  getPtyTaskContext: () => ({ projectPath: TASK.projectPath, taskId: TASK.taskId }),
  getPtySpawnContext: () => TASK,
}));
vi.mock('../ipc/helpers', () => ({ typedPush: vi.fn() }));
vi.mock('../sandbox/gitDir', () => ({ getMainGitDir: async () => '/Users/dev/code/proj/.git' }));

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
  registerSandboxProviders();
  await startHookServer({ isDestroyed: () => false, webContents: { send: vi.fn() } } as unknown as BrowserWindow);
});
afterAll(() => stopHookServer());

describe('ouijit sandbox', () => {
  test('wraps one command for a host terminal, hands it a token of its own, and takes it back after', async () => {
    await setCustomSandboxConfig(TASK.projectPath, { command: '/opt/sb --strict' });
    const host = issueToken('pty-1', 'host');

    const sandboxed = await request('POST', '/api/sandbox/wrap', issueToken('pty-2', 'sandbox'), {
      argv: ['claude'],
      cwd: TASK.worktreePath,
      backend: 'custom',
    });
    expect(sandboxed.status).toBe(403);

    const wrap = await request('POST', '/api/sandbox/wrap', host, {
      argv: ['claude', '--dangerously-skip-permissions'],
      cwd: TASK.worktreePath,
      backend: 'custom',
    });
    expect(wrap.status).toBe(200);
    const wrapped = wrap.data.data as { file: string; args: string[]; env: Record<string, string>; token: string };
    expect([wrapped.file, ...wrapped.args]).toEqual([
      '/opt/sb',
      '--strict',
      '--',
      'claude',
      '--dangerously-skip-permissions',
    ]);
    expect(wrapped.env.OUIJIT_API_TOKEN).toBe(wrapped.token);
    expect(vi.mocked(typedPush)).toHaveBeenLastCalledWith(expect.anything(), 'terminal-sandbox', {
      ptyId: 'pty-1',
      sandboxProvider: 'custom',
    });

    const own = `/api/tasks/3/status?project=${encodeURIComponent(TASK.projectPath)}`;
    expect((await request('PATCH', own, wrapped.token, { status: 'in_review' })).status).toBe(403);
    expect((await request('GET', '/api/hooks', wrapped.token)).status).toBe(403);

    expect((await request('POST', '/api/sandbox/release', host, { token: wrapped.token })).status).toBe(200);
    expect((await request('GET', '/api/tasks/current', wrapped.token)).status).toBe(401);
    expect(vi.mocked(typedPush)).toHaveBeenLastCalledWith(expect.anything(), 'terminal-sandbox', {
      ptyId: 'pty-1',
      sandboxProvider: undefined,
    });
  });
});
