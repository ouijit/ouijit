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
import { _resetCacheForTesting, saveScript } from '../../db';
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
    if (channel === 'cli:ask-op') {
      void handler('cli-asks:respond')({} as never, op.requestId, { ok: true, answer: { status: 'pending' } });
    }
  };
}

const panelOps = () => sent.filter(([c]) => c === 'cli:panel-op').map(([, op]) => op as CliPanelOp);

async function add(token: string, onto: string, kind: string, body: Record<string, unknown>) {
  sent.length = 0;
  const res = await fetch(`http://127.0.0.1:${getApiPort()}/api/panels/${onto}/${kind}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { data?: Record<string, unknown>; error?: string };
  return { status: res.status, data: json.data, error: json.error };
}

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
    expect((await add(token, sandboxed, 'runner', { script: 'Dev', sandbox: 'nono' })).status).toBe(403);

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
      expect((await add(token, sandboxed, 'preview', { url })).status).toBe(200);
      expect(panelOps()).toMatchObject([{ action: 'add', kind: 'preview', value: url }]);
    }

    // Any other page waits, showing the url, and opens only once the user presses Open.
    const page = await add(token, sandboxed, 'preview', { url: 'https://example.com/admin' });
    expect(page.data).toMatchObject({ status: 'pending' });
    expect(panelOps()).toEqual([]);
    const open = decisions().find((d) => d.ask.url === 'https://example.com/admin')!;
    expect(open).toMatchObject({ from: sandboxed, ask: { command: 'https://example.com/admin' } });
    await decide(open.id, { kind: 'run' });
    expect(await until(() => panelOps()[0], 'the preview')).toMatchObject({
      ptyId: sandboxed,
      kind: 'preview',
      value: 'https://example.com/admin',
    });
    await add(token, sandboxed, 'preview', { url: 'https://example.org' });
    await decide(decisions().find((d) => d.ask.url === 'https://example.org')!.id, { kind: 'decline' });
    expect(panelOps()).toEqual([]);

    // It still adds only to its own terminal.
    expect((await add(token, host, 'preview', { url: 'http://localhost:3000' })).status).toBe(403);
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
    expect((await add(token, sandboxed, 'preview', { url: 'https://example.com' })).status).toBe(200);
    expect(panelOps()).toMatchObject([{ ptyId: sandboxed, kind: 'preview', value: 'https://example.com' }]);
    expect(decisions()).toEqual([]);
  });
});
