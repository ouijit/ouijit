import { describe, test, expect, beforeEach, vi } from 'vitest';

import { addProjectTerminal, restartRunner, startRunner } from '../../components/terminal/terminalActions';
import { OuijitTerminal } from '../../components/terminal/terminalReact';
import { terminalInstances } from '../../components/terminal/terminalRegistry';
import { useProjectStore } from '../../stores/projectStore';
import type { PtySpawnOptions, SandboxProviderId } from '../../types';

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
    sandboxProvider?: SandboxProviderId;
    panels: Array<Record<string, unknown> & { id: string }> = [];
    runnerChildren = new Map<string, unknown>();
    runnerSpawning = new Set<string>();
    xterm = { cols: 80, rows: 24, writeln: vi.fn(), focus: vi.fn() };
    openTerminal = vi.fn();
    bind = vi.fn();
    dispose = vi.fn();
    refreshGitStatus = vi.fn();
    loadTags = vi.fn();
    setProjectNameGetter = vi.fn();
    killRunnerChild = vi.fn();
    setRunnerChild = vi.fn((id: string, child: unknown) => this.runnerChildren.set(id, child));
    spawnPty = vi.fn(async (opts: PtySpawnOptions) => {
      shellSpawns.calls.push(opts);
      return shellSpawns.result;
    });
    constructor(opts: { projectPath: string; worktreePath?: string; sandboxProvider?: SandboxProviderId }) {
      this.projectPath = opts.projectPath;
      this.worktreePath = opts.worktreePath;
      this.sandboxProvider = opts.sandboxProvider;
    }
    addRunnerPanel(script: { name: string; command: string; sandboxProvider?: SandboxProviderId }) {
      const id = `panel-${this.panels.length}`;
      this.panels.push({
        id,
        kind: 'runner',
        scriptName: script.name,
        scriptCommand: script.command,
        ...(script.sandboxProvider && script.sandboxProvider !== 'none' && { sandboxProvider: script.sandboxProvider }),
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

function sandboxOfLastSpawn(): SandboxProviderId | undefined {
  return vi.mocked(window.api.pty.spawn).mock.lastCall?.[0].sandboxProvider;
}

describe('sandboxed spawns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    terminalInstances.clear();
    useProjectStore.setState({ availableSandboxProviders: [], configProjectPath: PROJECT });
    vi.mocked(window.api.hooks.get).mockResolvedValue({});
    shellSpawns.result = 'pty-1';
    shellSpawns.calls = [];
  });

  test("a runner runs where it was started to, whatever its terminal's sandbox, and restarts there", async () => {
    const parent = new (OuijitTerminal as unknown as new (o: object) => OuijitTerminal)({
      projectPath: PROJECT,
      worktreePath: '/wt/T-7',
      sandboxProvider: 'custom',
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

  test("reopening a task runs its continue hook in that hook's sandbox, and an explicit choice wins", async () => {
    vi.mocked(window.api.hooks.get).mockResolvedValue({
      continue: { id: 'h', type: 'continue', name: 'Continue', command: 'claude -c', sandbox: 'custom' },
    });
    await addProjectTerminal(PROJECT, undefined, { existingWorktree: WORKTREE });
    await addProjectTerminal(PROJECT, undefined, { existingWorktree: WORKTREE, sandboxProvider: 'none' });

    expect(shellSpawns.calls.map((c) => [c.command, c.sandboxProvider])).toEqual([
      ['claude -c', 'custom'],
      ['claude -c', undefined],
    ]);
  });

  test('a sandbox that cannot start fails the open, never swapped for a host shell', async () => {
    shellSpawns.result = null;

    // The store says Custom cannot run; the spawn is still asked for it.
    const opened = await addProjectTerminal(PROJECT, undefined, {
      existingWorktree: { ...WORKTREE, sandboxProvider: 'custom' },
      skipAutoHook: true,
    });

    expect(opened).toBe(false);
    expect(shellSpawns.calls.map((c) => c.sandboxProvider)).toEqual(['custom']);
  });
});
