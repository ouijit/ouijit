/**
 * End-to-end auth + scope checks on the REST router by driving the
 * hook server with a real HTTP client. Covers:
 *   - Unauthenticated requests get 401.
 *   - Host-only routes reject sandbox-scoped tokens with 403.
 *   - Panel routes are host-only: sandbox-scoped tokens are refused.
 *   - POST /api/tasks/start with sandboxed:false is refused on sandbox scope.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as http from 'node:http';
import type { BrowserWindow } from 'electron';

const { getPtyTaskContextMock } = vi.hoisted(() => ({
  getPtyTaskContextMock: vi.fn<() => { projectPath: string; taskId: number } | null>(),
}));

vi.mock('../ptyManager', () => ({
  isPtyActive: () => true,
  getPtyTaskContext: () => getPtyTaskContextMock(),
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
  getGlobalSetting: vi.fn(async () => undefined),
  setGlobalSetting: vi.fn(async () => ({ success: true })),
}));

vi.mock('../taskLifecycle', () => ({
  beginTask: vi.fn(async () => ({})),
  setTaskStatusWithHooks: vi.fn(async () => ({})),
  deleteTaskWithWorktree: vi.fn(async () => ({})),
  getTasksWithWorkspaces: vi.fn(async () => []),
  getTaskWithWorkspace: vi.fn(async () => null),
}));

vi.mock('../projectList', () => ({
  getProjectList: vi.fn(async () => []),
}));

// Panel routes forward to the renderer via this bridge; stub it so the route's
// own auth/scope checks are what we exercise, not the renderer round-trip.
vi.mock('../cliPanels', () => ({
  cliPanelRequest: vi.fn(async () => ({ ok: true, panels: [] })),
}));

import { startHookServer, stopHookServer, getApiPort } from '../hookServer';
import { issueToken, revokeAllTokens } from '../apiAuth';
import { getTaskWithWorkspace } from '../taskLifecycle';
import { typedPush } from '../ipc/helpers';

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
  getPtyTaskContextMock.mockReturnValue(null);
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

describe('sandbox read-only, own-task scope', () => {
  const OWN = { projectPath: '/tmp/test-project', taskId: 7 };

  test('sandbox token can read its own current task', async () => {
    getPtyTaskContextMock.mockReturnValue(OWN);
    vi.mocked(getTaskWithWorkspace).mockResolvedValueOnce({ taskNumber: 7 } as never);
    const token = issueToken('pty-sbx', 'sandbox');
    const res = await request('GET', '/api/tasks/current', token);
    expect(res.status).toBe(200);
  });

  test('sandbox token can read its own task by number', async () => {
    getPtyTaskContextMock.mockReturnValue(OWN);
    vi.mocked(getTaskWithWorkspace).mockResolvedValueOnce({ taskNumber: 7 } as never);
    const token = issueToken('pty-sbx', 'sandbox');
    const res = await request('GET', `/api/tasks/7?project=${PROJECT}`, token);
    expect(res.status).toBe(200);
  });

  test('sandbox token gets 403 reading a different task by number', async () => {
    getPtyTaskContextMock.mockReturnValue(OWN);
    const token = issueToken('pty-sbx', 'sandbox');
    const res = await request('GET', `/api/tasks/9?project=${PROJECT}`, token);
    expect(res.status).toBe(403);
  });

  test('sandbox token gets 403 reading its number in a different project', async () => {
    getPtyTaskContextMock.mockReturnValue(OWN);
    const token = issueToken('pty-sbx', 'sandbox');
    const res = await request('GET', `/api/tasks/7?project=${encodeURIComponent('/tmp/other')}`, token);
    expect(res.status).toBe(403);
  });

  test('sandbox token gets 403 mutating even its own task (status PATCH)', async () => {
    getPtyTaskContextMock.mockReturnValue(OWN);
    const token = issueToken('pty-sbx', 'sandbox');
    const res = await request('PATCH', `/api/tasks/7/status?project=${PROJECT}`, token, { status: 'done' });
    expect(res.status).toBe(403);
  });

  test('host token still reads any task by number', async () => {
    vi.mocked(getTaskWithWorkspace).mockResolvedValueOnce({ taskNumber: 9 } as never);
    const token = issueToken('pty-host', 'host');
    const res = await request('GET', `/api/tasks/9?project=${PROJECT}`, token);
    expect(res.status).toBe(200);
  });
});

describe('theme routes', () => {
  test('theme routes validate, persist, and push cli:theme-changed; sandbox is refused', async () => {
    // Sandbox scope: read and write both refused (host-only routes).
    const sandboxToken = issueToken('pty-sbx', 'sandbox');
    expect((await request('GET', '/api/themes', sandboxToken)).status).toBe(403);
    expect(
      (
        await request('PUT', '/api/themes/custom/x', sandboxToken, {
          name: 'X',
          base: 'dark',
          tokens: {},
        })
      ).status,
    ).toBe(403);

    const token = issueToken('pty-host', 'host');

    // GET returns presets plus (empty) custom themes and the default preference.
    const list = await request('GET', '/api/themes', token);
    expect(list.status).toBe(200);
    const data = list.body.data as { preference: string; presets: unknown[]; customThemes: unknown[] };
    expect(data.preference).toBe('system');
    expect(data.presets.length).toBeGreaterThan(0);
    expect(data.customThemes).toEqual([]);

    // Invalid theme body → 400; valid body persists and pushes cli:theme-changed.
    const bad = await request('PUT', '/api/themes/custom/my-theme', token, { base: 'sepia', tokens: {} });
    expect(bad.status).toBe(400);
    const good = await request('PUT', '/api/themes/custom/my-theme', token, {
      name: 'My Theme',
      base: 'dark',
      tokens: { '--color-accent': '#ff2d55' },
    });
    expect(good.status).toBe(200);
    expect(vi.mocked(typedPush)).toHaveBeenCalledWith(expect.anything(), 'cli:theme-changed');

    // Preference validation: unknown custom id 404s, presets and built-ins work.
    expect((await request('PUT', '/api/themes/preference', token, { preference: 'custom:nope' })).status).toBe(404);
    expect((await request('PUT', '/api/themes/preference', token, { preference: 'sepia' })).status).toBe(400);
    expect((await request('PUT', '/api/themes/preference', token, { preference: 'custom:dracula' })).status).toBe(200);
    expect((await request('PUT', '/api/themes/preference', token, { preference: 'light' })).status).toBe(200);

    // Deleting a theme that doesn't exist → 404 (settings mock stores nothing).
    expect((await request('DELETE', '/api/themes/custom/nope', token)).status).toBe(404);
  });
});

describe('panel scope', () => {
  test('sandbox token cannot GET panels (host-only)', async () => {
    // The guest has no legitimate reason to read host panel state directly —
    // agent-detected plans flow through /hook action:plan, which server-joins
    // safely under ~/.claude/plans. Keep panel routes host-only.
    const token = issueToken('pty-42', 'sandbox');
    const res = await request('GET', '/api/panels/pty-42/markdown', token);
    expect(res.status).toBe(403);
  });

  test('sandbox token cannot POST a markdown panel', async () => {
    // An attacker with a sandbox token must not be able to steer the
    // host renderer to open an arbitrary .md file on the host.
    const token = issueToken('pty-42', 'sandbox');
    const res = await request('POST', '/api/panels/pty-42/markdown', token, { path: '/tmp/x.md' });
    expect(res.status).toBe(403);
  });

  test('host token can POST a markdown panel', async () => {
    const token = issueToken('pty-42', 'host');
    const res = await request('POST', '/api/panels/pty-42/markdown', token, { path: '/tmp/x.md' });
    expect(res.status).toBe(200);
  });

  test('host token can POST a preview panel', async () => {
    const token = issueToken('pty-42', 'host');
    const res = await request('POST', '/api/panels/pty-42/preview', token, { url: 'http://localhost:3000' });
    expect(res.status).toBe(200);
  });
});
