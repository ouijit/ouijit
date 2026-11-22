import { describe, test, expect, beforeEach, vi } from 'vitest';

import { addProjectTerminal, restartRunner, startRunner } from '../../components/terminal/terminalActions';
import { OuijitTerminal } from '../../components/terminal/terminalReact';
import { terminalInstances } from '../../components/terminal/terminalRegistry';
import { runApprovedAsk } from '../../services/askRun';
import { useHomeChatStore } from '../../stores/homeChatStore';
import type { ChatSnapshot } from '../../chat/model';
import type { PtySpawnOptions, SandboxPlacement } from '../../types';

vi.mock('electron-log/renderer', () => ({
  default: { scope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// xterm cannot construct under jsdom. The fake keeps the parts these spawns
// read and write — panels, the sandbox it was built with — and fails a
// spawn the way the real one does when the main process refuses it.
const shellSpawns = vi.hoisted(() => ({
  result: null as string | null,
  calls: [] as PtySpawnOptions[],
}));
vi.mock('../../components/terminal/terminalReact', () => {
  class FakeTerminal {
    ptyId = 'pending';
    projectPath: string;
    worktreePath?: string;
    sandbox?: SandboxPlacement;
    panels: Array<Record<string, unknown> & { id: string }> = [];
    runnerChildren = new Map<string, unknown>();
    runnerSpawning = new Set<string>();
    xterm = { cols: 80, rows: 24, writeln: vi.fn(), focus: vi.fn() };
    surface = 'terminal';
    focus() {
      this.xterm.focus();
    }
    openTerminal = vi.fn();
    bind = vi.fn();
    dispose = vi.fn();
    refreshGitStatus = vi.fn();
    setProjectNameGetter = vi.fn();
    killRunnerChild = vi.fn();
    setRunnerChild = vi.fn((id: string, child: unknown) => this.runnerChildren.set(id, child));
    spawnPty = vi.fn(async (opts: PtySpawnOptions) => {
      shellSpawns.calls.push(opts);
      return shellSpawns.result;
    });
    constructor(opts: { projectPath: string; worktreePath?: string; sandbox?: SandboxPlacement }) {
      this.projectPath = opts.projectPath;
      this.worktreePath = opts.worktreePath;
      this.sandbox = opts.sandbox;
    }
    addRunnerPanel(script: { name: string; command: string; sandbox?: SandboxPlacement }) {
      const id = `panel-${this.panels.length}`;
      this.panels.push({
        id,
        kind: 'runner',
        scriptName: script.name,
        scriptCommand: script.command,
        ...(script.sandbox && script.sandbox !== 'none' && { sandbox: script.sandbox }),
        status: 'idle',
      });
      return id;
    }
    updatePanel(id: string, patch: Record<string, unknown>) {
      Object.assign(this.panels.find((p) => p.id === id) ?? {}, patch);
    }
  }
  return { OuijitTerminal: FakeTerminal, resolveTerminalLabel: () => 'Shell' };
});

const PROJECT = '/project';
const WORKTREE = { path: '/wt/T-7', branch: 'T-7', createdAt: '' };

function sandboxOfLastSpawn(): SandboxPlacement | undefined {
  return vi.mocked(window.api.pty.spawn).mock.lastCall?.[0].sandbox;
}

describe('sandboxed spawns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    terminalInstances.clear();
    vi.mocked(window.api.hooks.get).mockResolvedValue({});
    shellSpawns.result = 'pty-1';
    shellSpawns.calls = [];
  });

  test("a runner runs where it was started to, whatever its terminal's sandbox, and restarts there", async () => {
    const parent = new (OuijitTerminal as unknown as new (o: object) => OuijitTerminal)({
      projectPath: PROJECT,
      worktreePath: '/wt/T-7',
      sandbox: 'custom',
    });
    terminalInstances.set('parent', parent);
    const script = { name: 'Dev', command: 'npm run dev' };

    await startRunner('parent', script);
    expect(sandboxOfLastSpawn()).toBeUndefined();

    const panelId = await startRunner('parent', script, 'nono');
    expect(sandboxOfLastSpawn()).toBe('nono');

    await restartRunner('parent', panelId!);
    expect(sandboxOfLastSpawn()).toBe('nono');
    expect(vi.mocked(window.api.pty.spawn).mock.lastCall?.[0]).toMatchObject({ cwd: '/wt/T-7', isRunner: true });
  });

  test("a sandboxed Chat's panels run what they start in Chat's sandbox, except an ask approved for the host", async () => {
    const chatsSandbox = { provider: 'nono' as const, settings: '/chat' };
    useHomeChatStore.setState({ currentId: 'home-1' });
    vi.mocked(window.api.chat.snapshot).mockResolvedValue({
      info: { id: 'home-1', role: 'home', sandbox: chatsSandbox },
    } as unknown as ChatSnapshot);
    const host = new (OuijitTerminal as unknown as new (o: object) => OuijitTerminal)({ projectPath: '/chat' });
    terminalInstances.set('home-1', host);
    const script = { name: 'Dev', command: 'npm run dev' };

    const started = await startRunner('home-1', script);
    expect(sandboxOfLastSpawn()).toEqual(chatsSandbox);
    await startRunner('home-1', script, 'custom');
    expect(sandboxOfLastSpawn()).toEqual(chatsSandbox);
    await restartRunner('home-1', started!);
    expect(sandboxOfLastSpawn()).toEqual(chatsSandbox);

    await runApprovedAsk('home-1', { command: 'git push', cwd: '/chat' }, false);
    expect(sandboxOfLastSpawn()).toBeUndefined();

    vi.mocked(window.api.chat.snapshot).mockResolvedValue({
      info: { id: 'home-1', role: 'home', sandbox: null },
    } as unknown as ChatSnapshot);
    await startRunner('home-1', script);
    expect(sandboxOfLastSpawn()).toBeUndefined();
    useHomeChatStore.setState({ currentId: null });
    vi.mocked(window.api.chat.snapshot).mockResolvedValue(null);
  });

  test("reopening a task runs its continue hook in that hook's sandbox, and an explicit choice wins", async () => {
    vi.mocked(window.api.hooks.get).mockResolvedValue({
      continue: { id: 'h', type: 'continue', name: 'Continue', command: 'claude -c', sandbox: 'custom' },
    });
    await addProjectTerminal(PROJECT, undefined, { existingWorktree: WORKTREE });
    await addProjectTerminal(PROJECT, undefined, { existingWorktree: WORKTREE, sandbox: 'none' });

    expect(shellSpawns.calls.map((c) => [c.command, c.sandbox])).toEqual([
      ['claude -c', 'custom'],
      ['claude -c', undefined],
    ]);
  });

  test('a sandbox that cannot start fails the open, never swapped for a host shell', async () => {
    shellSpawns.result = null;

    // The store says Custom cannot run; the spawn is still asked for it.
    const opened = await addProjectTerminal(PROJECT, undefined, {
      existingWorktree: WORKTREE,
      sandbox: 'custom',
      skipAutoHook: true,
    });

    expect(opened).toBe(false);
    expect(shellSpawns.calls.map((c) => c.sandbox)).toEqual(['custom']);
  });
});
