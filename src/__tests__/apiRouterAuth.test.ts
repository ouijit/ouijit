/**
 * End-to-end auth + scope checks on the REST router by driving the
 * hook server with a real HTTP client. Covers:
 *   - Unauthenticated requests get 401.
 *   - Host-only routes reject sandbox-scoped tokens with 403.
 *   - Sandbox-scoped tokens can hit plan/:ptyId but only for own ptyId.
 *   - POST /api/tasks/start with sandboxed:false is refused on sandbox scope.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as http from 'node:http';
import type { BrowserWindow } from 'electron';

vi.mock('../ptyManager', () => ({
  isPtyActive: () => true,
}));

// Prevent real IPC broadcasts; we're driving HTTP directly.
vi.mock('../ipc/helpers', () => ({
  typedPush: vi.fn(),
}));

// Stub the business-logic modules the router calls; we only care about
// which routes the auth layer allows through, not what they return.
vi.mock('../worktree', () => ({
  createTodoTask: vi.fn(async () => ({ ok: true })),
  createTaskWorktree: vi.fn(async () => ({ ok: true })),
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

vi.mock('../taskLifecycle', () => ({
  beginTask: vi.fn(async () => ({})),
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

const mockSend = vi.fn();
function mockWindow(): BrowserWindow {
  return {
    isDestroyed: () => false,
    webContents: { send: mockSend },
  } as unknown as BrowserWindow;
}

interface Response {
  status: number;
  body: Record<string, unknown>;
}

function request(method: string, path: string, token?: string, body?: Record<string, unknown>): Promise<Response> {
  return new Promise((resolve, reject) => {
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
  mockSend.mockClear();
  revokeAllTokens();
  await startHookServer(mockWindow());
});

afterEach(async () => {
  await stopHookServer();
});

const PROJECT = encodeURIComponent('/tmp/test-project');

describe('REST API auth', () => {
  test('rejects unauthenticated requests with 401', async () => {
    const res = await request('GET', `/api/tasks?project=${PROJECT}`);
    expect(res.status).toBe(401);
  });

  test('rejects unknown tokens with 401', async () => {
    const res = await request('GET', `/api/tasks?project=${PROJECT}`, 'not-a-real-token');
    expect(res.status).toBe(401);
  });

  test('host token can hit host-only routes', async () => {
    const token = issueToken('pty-host', 'host');
    const res = await request('GET', `/api/tasks?project=${PROJECT}`, token);
    expect(res.status).toBe(200);
  });

  test('sandbox token gets 403 on host-only routes', async () => {
    const token = issueToken('pty-sbx', 'sandbox');
    const res = await request('GET', `/api/tasks?project=${PROJECT}`, token);
    expect(res.status).toBe(403);
  });

  test.each([
    ['GET', '/api/tasks'],
    ['POST', '/api/tasks'],
    ['POST', '/api/tasks/start'],
    ['GET', '/api/hooks'],
    ['PUT', '/api/hooks/run'],
    ['GET', '/api/scripts'],
    ['PUT', '/api/scripts/abc'],
    ['GET', '/api/tags'],
    ['GET', '/api/projects'],
  ])('sandbox scope cannot hit %s %s', async (method, route) => {
    const token = issueToken('pty-sbx', 'sandbox');
    const res = await request(method, `${route}?project=${PROJECT}`, token, { name: 'x', type: 'run', command: 'x' });
    expect(res.status).toBe(403);
  });
});

describe('plan scope', () => {
  test('sandbox token cannot GET any plan (host-only)', async () => {
    // The guest has no legitimate reason to read plan paths directly —
    // it writes via /hook action:plan which server-joins safely under
    // ~/.claude/plans. Keep the GET endpoint host-only.
    const token = issueToken('pty-42', 'sandbox');
    const res = await request('GET', '/api/plan/pty-42', token);
    expect(res.status).toBe(403);
  });

  test('sandbox token cannot POST a plan path', async () => {
    // An attacker with a sandbox token must not be able to steer the
    // host renderer to read an arbitrary .md file on the host.
    const token = issueToken('pty-42', 'sandbox');
    const res = await request('POST', '/api/plan/pty-42', token, { path: '/tmp/x.md' });
    expect(res.status).toBe(403);
  });

  test('host token can POST a plan path', async () => {
    const token = issueToken('pty-42', 'host');
    const res = await request('POST', '/api/plan/pty-42', token, { path: '/tmp/x.md' });
    expect(res.status).toBe(200);
  });
});
