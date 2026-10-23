import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { Command } from 'commander';
import type { BrowserWindow } from 'electron';

import { registerTerminalCommands } from '../../cli/commands/terminal';
import { registerDiffCommands } from '../../cli/commands/diff';
import { registerTaskCommands } from '../../cli/commands/task';
import { startHookServer, stopHookServer, getApiPort } from '../../hookServer';
import { issueToken, revokeAllTokens } from '../../apiAuth';
import { createTask, getTaskByNumber, _resetCacheForTesting } from '../../db';
import { saveNote } from '../../diffNotesService';
import { setTrashItem } from '../../platform';
import type { ActiveSession } from '../../ptyManager';

const { sessions } = vi.hoisted(() => ({ sessions: [] as ActiveSession[] }));

// Live PTYs need a spawned shell; these records stand in for the ones open.
vi.mock('../../ptyManager', () => {
  const find = (ptyId: string) => sessions.find((s) => s.ptyId === ptyId);
  return {
    getActiveSessions: () => sessions,
    isPtyActive: (ptyId: string) => !!find(ptyId),
    getPtySpawnContext: (ptyId: string) => {
      const s = find(ptyId);
      return s
        ? {
            projectPath: s.projectPath,
            taskId: s.taskId,
            worktreePath: s.worktreePath,
            sandboxProvider: s.sandboxProvider,
          }
        : null;
    },
    getPtyTaskContext: (ptyId: string) => {
      const s = find(ptyId);
      return s?.taskId != null ? { projectPath: s.projectPath, taskId: s.taskId } : null;
    },
  };
});

let tmpDir: string;
let repoDir: string;
let worktree: string;
let trashDir: string;

const fakeWindow = {
  isDestroyed: () => false,
  webContents: { send: () => {} },
} as unknown as BrowserWindow;

async function ouijit(...args: string[]): Promise<unknown> {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((data) => {
    chunks.push(String(data));
    return true;
  });
  const program = new Command();
  program.exitOverride();
  registerTerminalCommands(program, () => repoDir);
  registerDiffCommands(program, () => repoDir);
  registerTaskCommands(program, () => repoDir);
  try {
    await program.parseAsync(args, { from: 'user' });
  } finally {
    spy.mockRestore();
  }
  return JSON.parse(chunks.join(''));
}

function as(ptyId: string, scope: 'host' | 'sandbox'): string {
  const token = issueToken(ptyId, scope);
  vi.stubEnv('OUIJIT_API_TOKEN', token);
  vi.stubEnv('OUIJIT_PTY_ID', ptyId);
  return token;
}

beforeEach(async () => {
  _resetCacheForTesting();
  revokeAllTokens();
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ouijit-cli-surface-'));
  repoDir = path.join(tmpDir, 'project');
  worktree = path.join(tmpDir, 'T-1');
  trashDir = path.join(tmpDir, 'trash');
  await fs.mkdir(repoDir);
  await fs.mkdir(trashDir);
  execSync('git init -q && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: repoDir });
  execSync(`git worktree add -q -b T-1 "${worktree}"`, { cwd: repoDir });
  await createTask(repoDir, 1, 'Fix auth', { branch: 'T-1', worktreePath: worktree });
  await fs.writeFile(path.join(worktree, 'auth.ts'), 'export function login() {\n  return token;\n}\n');

  sessions.splice(0, sessions.length, {
    ptyId: 'pty-agent',
    projectPath: repoDir,
    command: 'zsh',
    label: 'Fix auth',
    taskId: 1,
    worktreePath: worktree,
    sandboxProvider: 'nono',
  });
  sessions.push(
    { ptyId: 'pty-shell', projectPath: repoDir, command: 'zsh', label: 'Shell' },
    { ptyId: 'pty-runner', projectPath: repoDir, command: 'npm run dev', label: 'Run', isRunner: true },
  );

  await startHookServer(fakeWindow);
  vi.stubEnv('OUIJIT_API_URL', `http://127.0.0.1:${getApiPort()}`);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  setTrashItem(async (p) => {
    await fs.rm(p, { recursive: true, force: true });
  });
  await stopHookServer();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('what an agent can see and do from the CLI', () => {
  test('lists the open terminals but not their runners, with the status each agent last reported', async () => {
    const agentToken = as('pty-agent', 'host');
    await fetch(`http://127.0.0.1:${getApiPort()}/hook`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${agentToken}` },
      body: JSON.stringify({ action: 'status', ptyId: 'pty-agent', status: 'thinking' }),
    });

    expect(await ouijit('terminal', 'list')).toEqual([
      {
        ptyId: 'pty-agent',
        label: 'Fix auth',
        projectPath: repoDir,
        taskNumber: 1,
        worktreePath: worktree,
        sandbox: 'nono',
        agentStatus: 'thinking',
      },
      {
        ptyId: 'pty-shell',
        label: 'Shell',
        projectPath: repoDir,
        taskNumber: null,
        worktreePath: null,
        sandbox: 'none',
        agentStatus: null,
      },
    ]);

    // Other terminals' projects and tasks are the host's to see.
    as('pty-shell', 'sandbox');
    await expect(ouijit('terminal', 'list')).rejects.toThrow(/Forbidden/);
  });

  test("reads the notes on its own worktree's diff from a sandbox, and a task's from the host", async () => {
    await saveNote({
      worktreePath: worktree,
      path: 'auth.ts',
      line: 2,
      side: 'RIGHT',
      snippet: '  return token;',
      body: 'this is undefined before login',
    });
    await saveNote({
      worktreePath: repoDir,
      path: 'README.md',
      line: 1,
      side: 'LEFT',
      snippet: null,
      body: 'keep this',
    });
    const onAuth = expect.objectContaining({
      path: 'auth.ts',
      startLine: 2,
      line: 2,
      body: 'this is undefined before login',
    });

    as('pty-agent', 'sandbox');
    expect(await ouijit('diff', 'notes')).toEqual([onAuth]);
    await expect(ouijit('diff', 'notes', '--task', '1')).rejects.toThrow(/Forbidden/);

    // A shell's diff is of the project itself.
    as('pty-shell', 'host');
    expect(await ouijit('diff', 'notes')).toEqual([expect.objectContaining({ path: 'README.md', body: 'keep this' })]);
    expect(await ouijit('diff', 'notes', '--task', '1')).toEqual([onAuth]);
    await expect(ouijit('diff', 'notes', '--task', '9')).rejects.toThrow(/Task 9 not found/);
  });

  test('trashing a task removes it and its branch, and sends its worktree to the trash rather than deleting it', async () => {
    setTrashItem((p) => fs.rename(p, path.join(trashDir, path.basename(p))));
    as('pty-shell', 'host');

    expect(await ouijit('task', 'trash', '1')).toEqual(expect.objectContaining({ success: true, trashed: true }));

    expect(await getTaskByNumber(repoDir, 1)).toBeNull();
    expect(await fs.readFile(path.join(trashDir, 'T-1', 'auth.ts'), 'utf8')).toContain('login');
    expect(execSync('git worktree list', { cwd: repoDir, encoding: 'utf8' })).not.toContain('T-1');
    expect(execSync('git branch --list T-1', { cwd: repoDir, encoding: 'utf8' })).toBe('');
  });
});
