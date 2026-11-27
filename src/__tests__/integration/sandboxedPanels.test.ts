import { describe, test, expect, vi, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { ipcMain, type BrowserWindow } from 'electron';

import { startHookServer, stopHookServer } from '../../hookServer';
import { getApiPort } from '../../apiPort';
import { issueToken } from '../../apiAuth';
import { initCliPanels } from '../../cliPanels';
import { killPty, spawnPty } from '../../ptyManager';
import { decide, decisions } from '../../decisions';
import { _resetCacheForTesting, saveScript, setGlobalSetting } from '../../db';
import { sandboxCliAccessSettingKey } from '../../sandbox/types';
import { setCustomSandboxConfig } from '../../sandbox/custom/config';
import type { CliAskOp, CliPanelOp } from '../../types';

const sent: [string, ...unknown[]][] = [];
const window = {
  isDestroyed: () => false,
  webContents: { send: (channel: string, ...args: unknown[]) => sent.push([channel, ...args]) },
} as unknown as BrowserWindow;

let tmpDir: string;
let repo: string;
let sandboxed: string;
let host: string;

async function until<T>(read: () => T | undefined | null | false, what: string): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() - started > 10_000) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** The window, answering every panel op and approved ask it is sent, as the renderer does. */
function answerAsTheWindow(): void {
  const handlers = new Map(vi.mocked(ipcMain.handle).mock.calls);
  const handler = (channel: string) => handlers.get(channel)!;
  const send = window.webContents.send;
  window.webContents.send = (channel: string, ...args: unknown[]) => {
    send(channel, ...args);
    const op = args[0] as { requestId: number };
    if (channel === 'cli:panel-op')
      void handler('cli-panels:respond')({} as never, op.requestId, { ok: true, panels: [] });
    if (channel === 'cli:terminal-op') {
      void handler('cli-terminals:respond')({} as never, op.requestId, { ok: true, text: '' });
    }
    if (channel === 'cli:ask-op') {
      void handler('cli-asks:respond')({} as never, op.requestId, { ok: true, answer: { status: 'pending' } });
    }
  };
}

const panelOps = () => sent.filter(([c]) => c === 'cli:panel-op').map(([, op]) => op as CliPanelOp);

async function call(token: string, method: string, route: string, body?: Record<string, unknown>) {
  sent.length = 0;
  const res = await fetch(`http://127.0.0.1:${getApiPort()}/api/${route}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body && { 'Content-Type': 'application/json' }) },
    ...(body && { body: JSON.stringify(body) }),
  });
  const json = (await res.json()) as { data?: Record<string, unknown>; error?: string };
  return { status: res.status, data: json.data, error: json.error };
}

const add = (token: string, onto: string, kind: string, body: Record<string, unknown>) =>
  call(token, 'POST', `panels/${onto}/${kind}`, body);

beforeAll(async () => {
  _resetCacheForTesting();
  tmpDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ouijit-sandboxed-panels-')));
  repo = path.join(tmpDir, 'project');
  await fs.mkdir(repo);
  const launcher = path.join(tmpDir, 'launch.sh');
  await fs.writeFile(launcher, '#!/bin/sh\n[ "$1" = "--" ] && shift\nexec "$@"\n', { mode: 0o755 });
  expect((await setCustomSandboxConfig(repo, { command: launcher })).success).toBe(true);
  await saveScript(repo, { id: '', name: 'Dev', command: 'npm run dev' });
  await saveScript(repo, { id: '', name: 'Deploy', command: 'npm run deploy' });

  await startHookServer(window);
  initCliPanels(window);
  answerAsTheWindow();
  const options = { cwd: repo, projectPath: repo, label: 'Shell' };
  const inSandbox = await spawnPty(options, window, { provider: 'custom', settings: repo });
  const onHost = await spawnPty(options, window);
  if (!inSandbox.success || !onHost.success) throw new Error(inSandbox.error ?? onHost.error);
  sandboxed = inSandbox.ptyId!;
  host = onHost.ptyId!;
});

afterAll(async () => {
  killPty(sandboxed);
  killPty(host);
  await stopHookServer();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('a panel a sandboxed terminal adds', () => {
  test('runs in its own sandbox or opens its own machine at once, and waits for the user for anything else', async () => {
    const token = issueToken(sandboxed, 'sandbox');
    const ownSandbox = { provider: 'custom', settings: repo };

    // A runner runs in the caller's sandbox, over the project's host default.
    expect((await add(token, sandboxed, 'runner', { script: 'Dev' })).status).toBe(200);
    expect(panelOps()).toMatchObject([{ action: 'add', kind: 'runner', value: 'Dev', sandbox: ownSandbox }]);
    // In another sandbox it waits as one on the host does, and runs there once approved.
    const other = await add(token, sandboxed, 'runner', { script: 'Dev', sandbox: 'nono' });
    expect(other.data).toMatchObject({ status: 'pending' });
    const dev = decisions().find((d) => d.ask.command === 'npm run dev')!;
    expect(dev.ask.sandbox).toEqual({ provider: 'nono', settings: repo });
    await decide(dev.id, { kind: 'run' });
    expect(await until(() => sent.find(([c]) => c === 'cli:ask-op')?.[1] as CliAskOp, 'the run')).toMatchObject({
      ask: { command: 'npm run dev', sandbox: { provider: 'nono', settings: repo } },
    });

    // On the host it waits, showing the script, and runs on the card once the user presses Run.
    const asked = await add(token, sandboxed, 'runner', { script: 'Deploy', sandbox: 'none', message: 'Keychain' });
    expect(asked.data).toMatchObject({ command: 'npm run deploy', status: 'pending' });
    expect(panelOps()).toEqual([]);
    const deploy = decisions().find((d) => d.ask.command === 'npm run deploy')!;
    expect(deploy).toMatchObject({ from: sandboxed, message: 'Keychain', ask: { scriptName: 'Deploy' } });
    await decide(deploy.id, { kind: 'run' });
    const ran = await until(() => sent.find(([c]) => c === 'cli:ask-op')?.[1] as CliAskOp, 'the run');
    expect(ran).toMatchObject({ fromPtyId: sandboxed, ask: { command: 'npm run deploy' } });

    // Its own machine's pages open at once.
    for (const url of ['http://localhost:3000', 'http://127.0.0.1:8080/x', 'http://[::1]:5173']) {
      expect((await add(token, sandboxed, 'browser', { url })).status).toBe(200);
      expect(panelOps()).toMatchObject([{ action: 'add', kind: 'browser', value: url }]);
    }

    // Any other page waits, showing the url, and opens only once the user presses Open.
    const page = await add(token, sandboxed, 'browser', { url: 'https://example.com/admin' });
    expect(page.data).toMatchObject({ status: 'pending' });
    expect(panelOps()).toEqual([]);
    const open = decisions().find((d) => d.ask.url === 'https://example.com/admin')!;
    expect(open).toMatchObject({ from: sandboxed, ask: { command: 'https://example.com/admin' } });
    await decide(open.id, { kind: 'run' });
    expect(await until(() => panelOps()[0], 'the browser tab')).toMatchObject({
      ptyId: sandboxed,
      kind: 'browser',
      value: 'https://example.com/admin',
    });
    await add(token, sandboxed, 'browser', { url: 'https://example.org' });
    await decide(decisions().find((d) => d.ask.url === 'https://example.org')!.id, { kind: 'decline' });
    expect(panelOps()).toEqual([]);

    // It still adds only to its own terminal.
    expect((await add(token, host, 'browser', { url: 'http://localhost:3000' })).status).toBe(403);
    expect((await add(token, host, 'runner', { script: 'Dev' })).status).toBe(403);
    expect(decisions()).toEqual([]);
  });

  test("from the host, adds as it always has: a runner where it asks or the window's default, any page at once", async () => {
    const token = issueToken(host, 'host');
    expect((await add(token, host, 'runner', { script: 'Dev' })).status).toBe(200);
    expect(panelOps()[0].sandbox).toBeUndefined();
    expect((await add(token, host, 'runner', { script: 'Dev', sandbox: 'none' })).status).toBe(200);
    expect(panelOps()[0].sandbox).toBe('none');
    expect((await add(token, host, 'runner', { script: 'Dev', sandbox: 'custom' })).status).toBe(200);
    expect(panelOps()[0].sandbox).toEqual({ provider: 'custom', settings: repo });
    expect((await add(token, sandboxed, 'browser', { url: 'https://example.com' })).status).toBe(200);
    expect(panelOps()).toMatchObject([{ ptyId: sandboxed, kind: 'browser', value: 'https://example.com' }]);
    expect(decisions()).toEqual([]);
  });
});

describe('a shell beside a terminal', () => {
  test('from a sandbox opens in that sandbox, or anywhere else once the user approves, and a sandbox reaches only the terminals in its own', async () => {
    const ownSandbox = { provider: 'custom', settings: repo };
    const token = issueToken(sandboxed, 'sandbox');
    expect((await add(token, sandboxed, 'runner', { shell: true })).status).toBe(200);
    expect(panelOps()).toMatchObject([{ action: 'add', kind: 'runner', shell: true, sandbox: ownSandbox }]);
    // Anywhere else it is an ask, which the user opens, privately or not, on the card that asked.
    for (const [sandbox, place] of [
      ['none', undefined],
      ['nono', { provider: 'nono', settings: repo }],
    ] as const) {
      const asked = await add(token, sandboxed, 'runner', { shell: true, sandbox, message: 'To sign in' });
      expect(asked.data).toMatchObject({ status: 'pending' });
      expect(panelOps()).toEqual([]);
      const shell = decisions().find((d) => d.ask.shell)!;
      expect(shell).toMatchObject({ from: sandboxed, message: 'To sign in', ask: { cwd: repo } });
      expect(shell.ask.sandbox).toEqual(place);
      await decide(shell.id, { kind: 'run', privately: true });
      expect(await until(() => sent.find(([c]) => c === 'cli:ask-op')?.[1] as CliAskOp, 'the shell')).toMatchObject({
        fromPtyId: sandboxed,
        privately: true,
        ask: { shell: true },
      });
    }
    expect(decisions()).toEqual([]);

    // A panel read carries the reader, which the window holds a shell's screen to.
    expect((await call(token, 'GET', `panels/${sandboxed}/panel-1/screen`)).status).toBe(200);
    expect(panelOps()).toMatchObject([{ action: 'read', readerSandbox: ownSandbox, readerPtyId: sandboxed }]);

    // Even at Whole board, a terminal on the host is out of reach: it may be the user's own shell.
    await setGlobalSetting(sandboxCliAccessSettingKey(repo), 'all');
    const whole = issueToken(sandboxed, 'sandbox');
    expect((await call(whole, 'GET', `terminals/${host}/screen`)).status).toBe(403);
    expect((await call(whole, 'POST', `terminals/${host}/paste`, { text: 'rm -rf ~' })).status).toBe(403);
    expect((await call(whole, 'GET', `terminals/${sandboxed}/screen`)).status).toBe(200);
    await setGlobalSetting(sandboxCliAccessSettingKey(repo), 'read');

    // From the host it opens where asked, or the window's default, and reads anything.
    const fromHost = issueToken(host, 'host');
    expect((await add(fromHost, host, 'runner', { shell: true })).status).toBe(200);
    expect(panelOps()).toMatchObject([{ kind: 'runner', shell: true }]);
    expect(panelOps()[0].sandbox).toBeUndefined();
    expect((await add(fromHost, host, 'runner', { shell: true, sandbox: 'none' })).status).toBe(200);
    expect(panelOps()[0].sandbox).toBe('none');
    expect((await call(fromHost, 'GET', `panels/${host}/panel-1/screen`)).status).toBe(200);
    expect(panelOps()[0].readerSandbox).toBeUndefined();
    expect((await call(fromHost, 'GET', `terminals/${sandboxed}/screen`)).status).toBe(200);
  });
});
