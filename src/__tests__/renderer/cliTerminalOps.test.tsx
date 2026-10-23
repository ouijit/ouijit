import { describe, test, expect, beforeEach, vi } from 'vitest';

import { addProjectTerminal } from '../../components/terminal/terminalActions';
import { terminalInstances } from '../../components/terminal/terminalRegistry';
import { installCliPanelListener } from '../../services/cliPanelListener';
import { installCliTerminalListener } from '../../services/cliTerminalListener';
import { useProjectDataStore } from '../../stores/projectDataStore';
import { useTerminalStore } from '../../stores/terminalStore';
import type {
  CliPanelOp,
  CliPanelResponse,
  CliTerminalOp,
  CliTerminalResponse,
  PtySpawnOptions,
  SandboxProviderId,
  TaskWithWorkspace,
} from '../../types';

vi.mock('electron-log/renderer', () => ({
  default: { scope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// xterm cannot construct under jsdom. The fake keeps the panel list the way
// OuijitTerminal does — one active panel or none, the diff beside them — and
// spawns the next PTY id it is handed.
const spawned = vi.hoisted(() => ({ next: [] as string[], calls: [] as PtySpawnOptions[] }));
vi.mock('../../components/terminal/terminalReact', () => {
  class FakeTerminal {
    ptyId = 'pending';
    projectPath: string;
    worktreePath?: string;
    sandboxProvider?: SandboxProviderId;
    panels: Array<Record<string, unknown> & { id: string; kind: string }> = [];
    activePanelId: string | null = null;
    diffPanelOpen = false;
    runnerChildren = new Map<string, unknown>();
    runnerSpawning = new Set<string>();
    xterm = { cols: 80, rows: 24, writeln: vi.fn(), focus: vi.fn() };
    openTerminal = vi.fn();
    bind = vi.fn();
    dispose = vi.fn();
    refreshGitStatus = vi.fn();
    setProjectNameGetter = vi.fn();
    killRunnerChild = vi.fn();
    setRunnerChild = vi.fn();
    spawnPty = vi.fn(async (opts: PtySpawnOptions) => {
      spawned.calls.push(opts);
      const ptyId = spawned.next.shift() ?? null;
      if (ptyId) this.ptyId = ptyId;
      return ptyId;
    });
    constructor(opts: { projectPath: string; worktreePath?: string; sandboxProvider?: SandboxProviderId }) {
      this.projectPath = opts.projectPath;
      this.worktreePath = opts.worktreePath;
      this.sandboxProvider = opts.sandboxProvider;
    }
    private append(panel: Record<string, unknown> & { kind: string }): string {
      const id = `panel-${this.panels.length + 1}`;
      this.panels.push({ ...panel, id });
      this.activePanelId = id;
      return id;
    }
    addRunnerPanel(script: { name: string; command: string; sandboxProvider?: SandboxProviderId }) {
      return this.append({
        kind: 'runner',
        scriptName: script.name,
        scriptCommand: script.command,
        ...(script.sandboxProvider && script.sandboxProvider !== 'none' && { sandboxProvider: script.sandboxProvider }),
        status: 'idle',
      });
    }
    addPlanPanel(planPath: string) {
      return this.append({ kind: 'plan', planPath });
    }
    addWebPreviewPanel(url: string) {
      return this.append({ kind: 'webPreview', url });
    }
    updatePanel(id: string, patch: Record<string, unknown>) {
      Object.assign(this.panels.find((p) => p.id === id) ?? {}, patch);
    }
    activatePanel(id: string) {
      this.activePanelId = id;
    }
    deactivatePanel() {
      this.activePanelId = null;
    }
    closePanel(id: string) {
      this.panels = this.panels.filter((p) => p.id !== id);
      if (this.activePanelId === id) this.activePanelId = this.panels.at(-1)?.id ?? null;
    }
    setDiffPanelOpen(open: boolean) {
      this.diffPanelOpen = open;
    }
  }
  return { OuijitTerminal: FakeTerminal, resolveTerminalLabel: () => 'Shell' };
});

const PROJECT = '/work/alpha';
const started = {
  taskNumber: 4,
  name: 'Four',
  status: 'in_progress',
  branch: 'T-4',
  worktreePath: '/wt/T-4',
  createdAt: '2026-10-01T00:00:00.000Z',
} as TaskWithWorkspace;
const neverStarted = { taskNumber: 9, name: 'Nine', status: 'todo', createdAt: '' } as TaskWithWorkspace;

function bridge<Op extends { requestId: number }, Reply>(api: {
  onOp: (cb: (op: Op) => void) => () => void;
  respond: (requestId: number, reply: Reply) => Promise<void>;
}): (op: Omit<Op, 'requestId'>) => Promise<Reply> {
  let send: (op: Op) => void = () => {};
  vi.mocked(api.onOp).mockImplementation((cb) => {
    send = cb;
    return () => {};
  });
  let requestId = 0;
  return async (op) => {
    const id = ++requestId;
    send({ ...op, requestId: id } as Op);
    await vi.waitFor(() => expect(vi.mocked(api.respond).mock.calls.some(([r]) => r === id)).toBe(true));
    return vi.mocked(api.respond).mock.calls.find(([r]) => r === id)![1];
  };
}

let terminalOp: (op: Omit<CliTerminalOp, 'requestId'>) => Promise<CliTerminalResponse>;
let panelOp: (op: Omit<CliPanelOp, 'requestId'>) => Promise<CliPanelResponse>;

beforeEach(async () => {
  vi.clearAllMocks();
  terminalInstances.clear();
  useTerminalStore.setState({ displayStates: {}, terminalsByProject: {}, order: [] });
  useProjectDataStore.setState({ configByProject: {} });
  vi.mocked(window.api.hooks.get).mockResolvedValue({});
  window.api.task.checkWorktree = vi.fn().mockResolvedValue({ status: 'present', worktreePath: '/wt/T-4' });
  window.api.task.start = vi.fn();
  vi.mocked(window.api.task.getByNumber).mockImplementation(async (_p, n) =>
    n === 4 ? started : n === 9 ? neverStarted : null,
  );
  spawned.calls = [];
  terminalOp = bridge(window.api.cliTerminals);
  panelOp = bridge(window.api.cliPanels);
  installCliTerminalListener();
  installCliPanelListener();

  spawned.next = ['pty-front'];
  await addProjectTerminal(PROJECT, undefined, {});
});

describe('terminals an agent opens and closes', () => {
  test("open behind the one you're looking at without taking the keyboard, and only on a started task", async () => {
    const front = terminalInstances.get('pty-front')!;
    vi.mocked(front.xterm.focus).mockClear();

    spawned.next = ['pty-task', 'pty-shell'];
    expect(await terminalOp({ action: 'open', projectPath: PROJECT, taskNumber: 4 })).toEqual({
      ok: true,
      ptyId: 'pty-task',
    });
    expect(spawned.calls.at(-1)).toEqual(expect.objectContaining({ cwd: '/wt/T-4' }));
    expect(await terminalOp({ action: 'open', projectPath: PROJECT })).toEqual({ ok: true, ptyId: 'pty-shell' });

    expect(useTerminalStore.getState().order[0]).toBe('pty-front');
    expect(terminalInstances.get('pty-task')!.xterm.focus).not.toHaveBeenCalled();
    expect(terminalInstances.get('pty-shell')!.xterm.focus).not.toHaveBeenCalled();

    expect(await terminalOp({ action: 'open', projectPath: PROJECT, taskNumber: 9 })).toEqual({
      ok: false,
      error: expect.stringMatching(/not started/),
    });
    expect(window.api.task.start).not.toHaveBeenCalled();

    expect(await terminalOp({ action: 'close', ptyId: 'pty-task' })).toEqual({ ok: true, ptyId: 'pty-task' });
    expect(useTerminalStore.getState().terminalsByProject[PROJECT]).toEqual(['pty-front', 'pty-shell']);
  });
});

describe("a terminal's panels, from the CLI", () => {
  test('runs a script by id or name in the default sandbox, lists every kind, focuses one, and toggles the diff', async () => {
    vi.mocked(window.api.scripts.getAll).mockResolvedValue([
      { id: 'scr-1', name: 'Dev server', command: 'npm run dev', sortOrder: 0, restartIfRunning: false },
    ]);
    useProjectDataStore.setState({
      configByProject: { [PROJECT]: { defaultSandbox: 'nono' } as never },
    });
    const added = await panelOp({ ptyId: 'pty-front', action: 'add', kind: 'runner', value: 'scr-1' });
    expect(added.panels).toEqual([
      { id: 'panel-1', kind: 'runner', label: 'Dev server', script: 'Dev server', active: true },
    ]);
    expect(vi.mocked(window.api.pty.spawn).mock.lastCall?.[0]).toEqual(
      expect.objectContaining({ sandboxProvider: 'nono' }),
    );

    // Adding the same script again brings its panel forward rather than running it twice.
    await panelOp({ ptyId: 'pty-front', action: 'add', kind: 'markdown', value: '/wt/plan.md' });
    await panelOp({ ptyId: 'pty-front', action: 'add', kind: 'runner', value: 'Dev server' });
    const all = await panelOp({ ptyId: 'pty-front', action: 'list-all' });
    expect(all.panels?.map((p) => [p.kind, p.active])).toEqual([
      ['runner', true],
      ['markdown', false],
    ]);

    expect((await panelOp({ ptyId: 'pty-front', action: 'focus', value: 'panel-2' })).panels?.[1].active).toBe(true);
    expect(
      (await panelOp({ ptyId: 'pty-front', action: 'focus', value: 'terminal' })).panels?.some((p) => p.active),
    ).toBe(false);
    expect(await panelOp({ ptyId: 'pty-front', action: 'focus', value: 'panel-9' })).toEqual({
      ok: false,
      error: 'No panel panel-9',
    });

    expect((await panelOp({ ptyId: 'pty-front', action: 'diff-open' })).diffOpen).toBe(true);
    expect((await panelOp({ ptyId: 'pty-front', action: 'diff-close' })).diffOpen).toBe(false);

    const removed = await panelOp({ ptyId: 'pty-front', action: 'remove', kind: 'runner', value: 'scr-1' });
    expect(removed.panels).toEqual([]);
    expect(await panelOp({ ptyId: 'pty-front', action: 'add', kind: 'runner', value: 'nope' })).toEqual({
      ok: false,
      error: 'No script named nope',
    });
  });
});
