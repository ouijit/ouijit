/**
 * Verifies the API router fires the `cli:task-started` push channel after a
 * successful CLI-initiated task start, so the renderer can spawn a terminal
 * + run the configured hook (T-366). Companion to apiRouterAuth.test.ts.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as http from 'node:http';
import type { BrowserWindow } from 'electron';

vi.mock('../ptyManager', () => ({
  isPtyActive: () => true,
  getPtyTaskContext: () => null,
}));

const typedPushMock = vi.fn();
vi.mock('../ipc/helpers', () => ({
  typedPush: (...args: unknown[]) => typedPushMock(...args),
}));

const createTaskWorktreeMock = vi.fn();
vi.mock('../worktree', () => ({
  createTodoTask: vi.fn(async () => ({ success: true })),
  createTaskWorktree: (...args: unknown[]) => createTaskWorktreeMock(...args),
}));

vi.mock('../db', () => ({
  setTaskMergeTarget: vi.fn(),
  setTaskName: vi.fn(),
  setTaskDescription: vi.fn(),
  getHooks: vi.fn(() => ({})),
  saveHook: vi.fn(),
  deleteHook: vi.fn(),
  getAllTags: vi.fn(() => []),
  getTaskTags: vi.fn(() => []),
  addTagToTask: vi.fn(),
  removeTagFromTask: vi.fn(),
  setTaskTags: vi.fn(),
  getScripts: vi.fn(() => []),
  saveScript: vi.fn(),
  deleteScript: vi.fn(),
}));

const beginTaskMock = vi.fn();
vi.mock('../taskLifecycle', () => ({
  beginTask: (...args: unknown[]) => beginTaskMock(...args),
  setTaskStatusWithHooks: vi.fn(async () => ({})),
  deleteTaskWithWorktree: vi.fn(async () => ({})),
  getTasksWithWorkspaces: vi.fn(async () => []),
  getTaskWithWorkspace: vi.fn(async () => null),
}));

vi.mock('../scanner', () => ({
  getProjectList: vi.fn(async () => []),
}));

import { startHookServer, stopHookServer, getApiPort } from '../hookServer';
import { issueToken, revokeAllTokens } from '../apiAuth';

function mockWindow(): BrowserWindow {
  return {
    isDestroyed: () => false,
    webContents: { send: vi.fn() },
  } as unknown as BrowserWindow;
}

function request(method: string, path: string, token?: string, body?: Record<string, unknown>) {
  return new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    const port = getApiPort();
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk: Buffer) => (raw += chunk.toString()));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode!, body: raw ? JSON.parse(raw) : {} });
          } catch {
            resolve({ status: res.statusCode!, body: { raw } });
          }
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

beforeEach(async () => {
  typedPushMock.mockClear();
  createTaskWorktreeMock.mockReset();
  beginTaskMock.mockReset();
  revokeAllTokens();
  await startHookServer(mockWindow());
});

afterEach(async () => {
  await stopHookServer();
});

const PROJECT = encodeURIComponent('/tmp/test-project');

function getTaskStartedPushes() {
  return typedPushMock.mock.calls.filter((call) => call[1] === 'cli:task-started');
}

describe('cli:task-started push', () => {
  test('fires after POST /api/tasks/start when result is successful', async () => {
    createTaskWorktreeMock.mockResolvedValueOnce({
      success: true,
      worktreePath: '/tmp/wt/T-7',
      task: {
        taskNumber: 7,
        branch: 'feat-7',
        createdAt: '2026-05-10T00:00:00.000Z',
        sandboxed: false,
      },
    });
    const token = issueToken('pty-host', 'host');
    const res = await request('POST', `/api/tasks/start?project=${PROJECT}`, token, { name: 'x' });

    expect(res.status).toBe(200);
    const pushes = getTaskStartedPushes();
    expect(pushes).toHaveLength(1);
    expect(pushes[0][2]).toEqual({
      project: '/tmp/test-project',
      taskNumber: 7,
      worktreePath: '/tmp/wt/T-7',
      branch: 'feat-7',
      createdAt: '2026-05-10T00:00:00.000Z',
      sandboxed: false,
    });
  });

  test('fires after POST /api/tasks/:number/start when result is successful', async () => {
    beginTaskMock.mockResolvedValueOnce({
      success: true,
      worktreePath: '/tmp/wt/T-42',
      task: {
        taskNumber: 42,
        branch: 'fix-42',
        createdAt: '2026-05-10T01:00:00.000Z',
        sandboxed: true,
      },
    });
    const token = issueToken('pty-host', 'host');
    const res = await request('POST', `/api/tasks/42/start?project=${PROJECT}`, token, {});

    expect(res.status).toBe(200);
    const pushes = getTaskStartedPushes();
    expect(pushes).toHaveLength(1);
    expect(pushes[0][2]).toMatchObject({
      taskNumber: 42,
      worktreePath: '/tmp/wt/T-42',
      branch: 'fix-42',
      sandboxed: true,
    });
  });

  test('does not fire when start returns success:false', async () => {
    createTaskWorktreeMock.mockResolvedValueOnce({ success: false, error: 'boom' });
    const token = issueToken('pty-host', 'host');
    const res = await request('POST', `/api/tasks/start?project=${PROJECT}`, token, { name: 'x' });

    expect(res.status).toBe(200);
    expect(getTaskStartedPushes()).toHaveLength(0);
  });

  test('does not fire when start succeeds but task has no branch (defensive)', async () => {
    createTaskWorktreeMock.mockResolvedValueOnce({
      success: true,
      worktreePath: '/tmp/wt/T-9',
      task: { taskNumber: 9, createdAt: '2026-05-10T00:00:00.000Z' },
    });
    const token = issueToken('pty-host', 'host');
    const res = await request('POST', `/api/tasks/start?project=${PROJECT}`, token, { name: 'x' });

    expect(res.status).toBe(200);
    expect(getTaskStartedPushes()).toHaveLength(0);
  });

  test('still emits cli-change alongside cli:task-started', async () => {
    createTaskWorktreeMock.mockResolvedValueOnce({
      success: true,
      worktreePath: '/tmp/wt/T-1',
      task: { taskNumber: 1, branch: 'b', createdAt: '2026-05-10T00:00:00.000Z', sandboxed: false },
    });
    const token = issueToken('pty-host', 'host');
    await request('POST', `/api/tasks/start?project=${PROJECT}`, token, { name: 'x' });

    const channels = typedPushMock.mock.calls.map((c) => c[1]);
    expect(channels).toContain('cli-change');
    expect(channels).toContain('cli:task-started');
  });

  test('forwards hookMode + hookCommand from the request body into the push', async () => {
    createTaskWorktreeMock.mockResolvedValueOnce({
      success: true,
      worktreePath: '/tmp/wt/T-5',
      task: { taskNumber: 5, branch: 'feat-5', createdAt: '2026-05-10T00:00:00.000Z', sandboxed: false },
    });
    const token = issueToken('pty-host', 'host');
    const res = await request('POST', `/api/tasks/start?project=${PROJECT}`, token, {
      name: 'x',
      hookMode: 'command',
      hookCommand: 'claude',
    });

    expect(res.status).toBe(200);
    const pushes = getTaskStartedPushes();
    expect(pushes).toHaveLength(1);
    expect(pushes[0][2]).toMatchObject({ hookMode: 'command', hookCommand: 'claude' });
  });

  test('rejects an invalid hookMode with 400 and does not start the task', async () => {
    const token = issueToken('pty-host', 'host');
    const res = await request('POST', `/api/tasks/start?project=${PROJECT}`, token, {
      name: 'x',
      hookMode: 'bogus',
    });

    expect(res.status).toBe(400);
    expect(createTaskWorktreeMock).not.toHaveBeenCalled();
    expect(getTaskStartedPushes()).toHaveLength(0);
  });

  test('rejects hookMode "command" with no hookCommand', async () => {
    const token = issueToken('pty-host', 'host');
    const res = await request('POST', `/api/tasks/start?project=${PROJECT}`, token, {
      name: 'x',
      hookMode: 'command',
    });

    expect(res.status).toBe(400);
    expect(createTaskWorktreeMock).not.toHaveBeenCalled();
  });

  // The two task-start routes share the cli:task-started push code but
  // validate the request body independently. The tests above hit only
  // /api/tasks/start; these mirror them on /api/tasks/:number/start so a
  // future refactor that drops parseHookControl from one handler is caught.

  test('forwards hookMode + hookCommand on POST /api/tasks/:number/start', async () => {
    beginTaskMock.mockResolvedValueOnce({
      success: true,
      worktreePath: '/tmp/wt/T-3',
      task: { taskNumber: 3, branch: 'fix-3', createdAt: '2026-05-10T00:00:00.000Z', sandboxed: false },
    });
    const token = issueToken('pty-host', 'host');
    const res = await request('POST', `/api/tasks/3/start?project=${PROJECT}`, token, {
      hookMode: 'run',
    });

    expect(res.status).toBe(200);
    const pushes = getTaskStartedPushes();
    expect(pushes).toHaveLength(1);
    expect(pushes[0][2]).toMatchObject({ taskNumber: 3, hookMode: 'run' });
  });

  test('rejects invalid hookMode on POST /api/tasks/:number/start before starting the task', async () => {
    const token = issueToken('pty-host', 'host');
    const res = await request('POST', `/api/tasks/3/start?project=${PROJECT}`, token, {
      hookMode: 'bogus',
    });

    expect(res.status).toBe(400);
    expect(beginTaskMock).not.toHaveBeenCalled();
    expect(getTaskStartedPushes()).toHaveLength(0);
  });

  test('does not fire for unrelated mutating routes', async () => {
    const token = issueToken('pty-host', 'host');
    await request('PATCH', `/api/tasks/3/name?project=${PROJECT}`, token, { name: 'rename' });
    expect(getTaskStartedPushes()).toHaveLength(0);
  });
});
