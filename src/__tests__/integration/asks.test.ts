import { describe, test, expect, vi, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { Command } from 'commander';
import { ipcMain, type BrowserWindow } from 'electron';

import { registerAskCommands } from '../../cli/commands/ask';
import { startHookServer, stopHookServer } from '../../hookServer';
import { getApiPort } from '../../apiPort';
import { issueToken } from '../../apiAuth';
import { initCliPanels } from '../../cliPanels';
import { killPty, spawnPty } from '../../ptyManager';
import { decide, decisions } from '../../decisions';
import { _resetCacheForTesting } from '../../db';
import type { CliAskOp, CliAskResponse, Decision } from '../../types';

const sent: [string, ...unknown[]][] = [];
const window = {
  isDestroyed: () => false,
  webContents: { send: (channel: string, ...args: unknown[]) => sent.push([channel, ...args]) },
} as unknown as BrowserWindow;

let tmpDir: string;
let worktree: string;
let ptyId: string;
let respond: Parameters<typeof ipcMain.handle>[1];

async function ouijit(...args: string[]): Promise<unknown> {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((data) => {
    chunks.push(String(data));
    return true;
  });
  const program = new Command();
  program.exitOverride();
  registerAskCommands(program);
  try {
    await program.parseAsync(args, { from: 'user' });
  } finally {
    spy.mockRestore();
  }
  return JSON.parse(chunks.join(''));
}

async function until<T>(read: () => T | undefined | null | false, what: string): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() - started > 10_000) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const held = (command: string) => until(() => decisions().find((d) => d.ask.command === command), command);

/** The window, starting an approved run in its card's runner, as `cli:ask-op` asks it to. */
async function runsInTheWindow(answer: CliAskResponse): Promise<CliAskOp> {
  const op = await until(() => sent.find(([channel]) => channel === 'cli:ask-op')?.[1] as CliAskOp, 'the run');
  sent.length = 0;
  await respond({} as never, op.requestId, answer);
  return op;
}

beforeAll(async () => {
  _resetCacheForTesting();
  tmpDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ouijit-asks-')));
  const repo = path.join(tmpDir, 'project');
  worktree = path.join(tmpDir, 'T-1');
  await fs.mkdir(repo);
  await fs.mkdir(worktree);

  await startHookServer(window);
  initCliPanels(window);
  respond = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === 'cli-asks:respond')![1];
  const spawned = await spawnPty(
    { cwd: worktree, projectPath: repo, taskId: 1, worktreePath: worktree, label: 'Fix auth' },
    window,
  );
  if (!spawned.success) throw new Error(spawned.error);
  ptyId = spawned.ptyId!;
  vi.stubEnv('OUIJIT_API_URL', `http://127.0.0.1:${getApiPort()}`);
  vi.stubEnv('OUIJIT_API_TOKEN', issueToken(ptyId, 'host'));
  vi.stubEnv('OUIJIT_SESSION_ID', ptyId);
});

afterAll(async () => {
  killPty(ptyId);
  vi.unstubAllEnvs();
  await stopHookServer();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("a terminal's ask", () => {
  test('waits in the main process until the user decides, --wait hears how it went, and a closed terminal declines what it left', async () => {
    const signing = ouijit('ask', 'run', '--wait', '-m', 'Needs the keychain', '--', 'npm', 'run', 'sign');
    const sign = await held('npm run sign');
    expect(sign).toMatchObject<Partial<Decision>>({
      from: ptyId,
      kind: 'ask',
      message: 'Needs the keychain',
      ask: { command: 'npm run sign', cwd: worktree, wait: true },
    });

    // Approved, it runs on its card in the window, and the asker hears how that ended.
    const deciding = decide(sign.id, { kind: 'run', privately: true });
    const op = await runsInTheWindow({
      ok: true,
      answer: { status: 'exited', panelId: 'panel-1', exitCode: 0, private: true },
    });
    expect(op).toMatchObject({ fromPtyId: ptyId, privately: true, ask: { command: 'npm run sign' } });
    expect(await deciding).toBe(true);
    expect(await signing).toEqual({
      command: 'npm run sign',
      cwd: worktree,
      status: 'exited',
      panelId: 'panel-1',
      exitCode: 0,
      private: true,
    });
    expect(await decide(sign.id, { kind: 'decline' })).toBe(false);

    const cleaning = ouijit('ask', 'run', '--wait', '--', 'rm', '-rf', 'dist');
    await decide((await held('rm -rf dist')).id, { kind: 'decline' });
    expect(await cleaning).toEqual({ command: 'rm -rf dist', cwd: worktree, status: 'declined' });

    // Without --wait the reply comes at once, and the ask still waits on the user.
    expect(await ouijit('ask', 'run', '--', 'git', 'push')).toEqual({
      command: 'git push',
      cwd: worktree,
      status: 'pending',
    });
    const deploying = ouijit('ask', 'run', '--wait', '--', 'make', 'deploy');
    await held('make deploy');
    expect(decisions().map((d) => d.ask.command)).toEqual(['git push', 'make deploy']);

    killPty(ptyId);
    expect(await deploying).toEqual({ command: 'make deploy', cwd: worktree, status: 'declined' });
    expect(decisions()).toEqual([]);
    expect(sent.some(([channel]) => channel === 'cli:ask-op')).toBe(false);
  });
});
