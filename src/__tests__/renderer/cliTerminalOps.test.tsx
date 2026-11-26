import { describe, test, expect, beforeEach, vi } from 'vitest';

import { addProjectTerminal } from '../../components/terminal/terminalActions';
import { terminalInstances } from '../../components/terminal/terminalRegistry';
import { installCliPanelListener } from '../../services/cliPanelListener';
import { installCliTerminalListener } from '../../services/cliTerminalListener';
import { useProjectDataStore } from '../../stores/projectDataStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { useAppStore } from '../../stores/appStore';
import { useProjectStore } from '../../stores/projectStore';
import { openLink } from '../../links/openLink';
import type { OuijitTerminal } from '../../components/terminal/terminalReact';
import type {
  CliPanelOp,
  CliPanelResponse,
  CliTerminalOp,
  CliTerminalResponse,
  PtySpawnOptions,
  SandboxPlacement,
  TaskWithWorkspace,
} from '../../types';

vi.mock('electron-log/renderer', () => ({
  default: { scope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// xterm cannot construct under jsdom. The fake keeps the panel list the way
// OuijitTerminal does — one active panel or none, the diff beside them — and
// spawns the next PTY id it is handed.
const spawned = vi.hoisted(() => ({
  next: [] as string[],
  calls: [] as PtySpawnOptions[],
  during: undefined as (() => void) | undefined,
}));
vi.mock('../../components/terminal/terminalReact', () => {
  class FakeTerminal {
    ptyId = 'pending';
    projectPath: string;
    worktreePath?: string;
    sandbox?: SandboxPlacement;
    panels: Array<Record<string, unknown> & { id: string; kind: string }> = [];
    activePanelId: string | null = null;
    diffPanelOpen = false;
    runnerChildren = new Map<string, unknown>();
    runnerSpawning = new Set<string>();
    xterm = { cols: 80, rows: 24, writeln: vi.fn(), focus: vi.fn() };
    focus() {
      this.xterm.focus();
    }
    openTerminal = vi.fn();
    fit = vi.fn();
    bind = vi.fn();
    dispose = vi.fn();
    refreshGitStatus = vi.fn();
    bindChat = vi.fn();
    setAgentStatus = vi.fn();
    setProjectNameGetter = vi.fn();
    killRunnerChild = vi.fn();
    setRunnerChild = vi.fn();
    spawnPty = vi.fn(async (opts: PtySpawnOptions) => {
      spawned.calls.push(opts);
      spawned.during?.();
      // As the main process does: the id the caller chose, else a new one.
      const ptyId = opts.ptyId ?? spawned.next.shift() ?? null;
      if (ptyId) this.ptyId = ptyId;
      return ptyId;
    });
    constructor(opts: { ptyId?: string; projectPath: string; worktreePath?: string; sandbox?: SandboxPlacement }) {
      if (opts.ptyId) this.ptyId = opts.ptyId;
      this.projectPath = opts.projectPath;
      this.worktreePath = opts.worktreePath;
      this.sandbox = opts.sandbox;
    }
    private append(panel: Record<string, unknown> & { kind: string }): string {
      const id = `panel-${this.panels.length + 1}`;
      this.panels.push({ ...panel, id });
      this.activePanelId = id;
      return id;
    }
    addRunnerPanel(script: { name: string; command: string; sandbox?: SandboxPlacement }) {
      return this.append({
        kind: 'runner',
        scriptName: script.name,
        scriptCommand: script.command,
        ...(script.sandbox && script.sandbox !== 'none' && { sandbox: script.sandbox }),
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

    // Another terminal on the task gets its real id while this one opens; the reply still names this one.
    useTerminalStore
      .getState()
      .addTerminal(PROJECT, 'loading-terminal', { taskId: 4, isLoading: true }, { background: true });
    spawned.during = () => useTerminalStore.getState().rekeyTerminal('loading-terminal', 'pty-other');
    spawned.next = ['pty-minted', 'pty-minted-2'];
    const onTask = await terminalOp({ action: 'open', projectPath: PROJECT, taskNumber: 4 });
    spawned.during = undefined;
    expect(onTask.ok).toBe(true);
    const task = onTask.ptyId!;
    expect(task).not.toBe('pty-other');
    expect(spawned.calls.at(-1)).toEqual(expect.objectContaining({ cwd: '/wt/T-4', ptyId: task }));
    expect(useTerminalStore.getState().displayStates[task]).toMatchObject({ taskId: 4 });
    const shell = (await terminalOp({ action: 'open', projectPath: PROJECT })).ptyId!;
    expect(spawned.calls.at(-1)).toEqual(expect.objectContaining({ ptyId: shell }));

    expect(useTerminalStore.getState().order[0]).toBe('pty-front');
    expect(terminalInstances.get(task)!.xterm.focus).not.toHaveBeenCalled();
    expect(terminalInstances.get(shell)!.xterm.focus).not.toHaveBeenCalled();

    expect(await terminalOp({ action: 'open', projectPath: PROJECT, taskNumber: 9 })).toEqual({
      ok: false,
      error: expect.stringMatching(/not started/),
    });
    expect(window.api.task.start).not.toHaveBeenCalled();

    expect(await terminalOp({ action: 'close', ptyId: task })).toEqual({ ok: true, ptyId: task });
    expect(useTerminalStore.getState().terminalsByProject[PROJECT]).toEqual(['pty-front', 'pty-other', shell]);
  });

  test("opens a new chat on a started task the way its menu's New chat does, sends it the first message, and names it though another session on the task lands meanwhile", async () => {
    // The task's terminal is still coming up under a placeholder, and gets its real id while the chat opens.
    useTerminalStore
      .getState()
      .addTerminal(PROJECT, 'loading-terminal', { taskId: 4, isLoading: true }, { background: true });
    vi.mocked(window.api.chat.start).mockImplementation(async (options) => {
      useTerminalStore.getState().rekeyTerminal('loading-terminal', 'pty-terminal');
      return {
        info: { id: options.id!, agent: options.agent, status: 'idle', background: [] } as never,
        nodes: [],
        seq: 0,
      };
    });
    const reply = await terminalOp({
      action: 'open',
      projectPath: PROJECT,
      taskNumber: 4,
      sandbox: 'none',
      chat: { agent: 'codex', prompt: 'add tests for the timeout' },
    });
    expect(reply.ok).toBe(true);
    const id = reply.ptyId!;
    expect(id).not.toBe('pty-terminal');
    // A new conversation in the task's worktree, not the task's latest picked back up.
    expect(window.api.chat.latestForTask).not.toHaveBeenCalled();
    expect(window.api.chat.start).toHaveBeenCalledWith(
      expect.objectContaining({ id, agent: 'codex', cwd: '/wt/T-4', taskId: 4, worktreePath: '/wt/T-4' }),
    );
    expect(window.api.chat.prompt).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ text: 'add tests for the timeout' }),
      'auto',
    );
    expect(useTerminalStore.getState().displayStates[id]).toMatchObject({ surface: 'chat', taskId: 4 });
    expect(useTerminalStore.getState().order[0]).toBe('pty-front');

    expect(await terminalOp({ action: 'open', projectPath: PROJECT, taskNumber: 9, chat: {} })).toEqual({
      ok: false,
      error: expect.stringMatching(/not started/),
    });
  });

  test('resumes a task that opens as a chat by its last conversation, named by that id though another session lands meanwhile', async () => {
    vi.mocked(window.api.globalSettings.get).mockImplementation(async (key) =>
      key === 'chat:enabled'
        ? '1'
        : key === `chat:taskStart:${PROJECT}`
          ? JSON.stringify({ surface: 'chat' })
          : undefined,
    );
    useTerminalStore
      .getState()
      .addTerminal(PROJECT, 'loading-terminal', { taskId: 4, isLoading: true }, { background: true });
    vi.mocked(window.api.chat.start).mockImplementation(async (options) => {
      useTerminalStore.getState().rekeyTerminal('loading-terminal', 'pty-other');
      return {
        info: { id: options.id!, agent: options.agent, status: 'idle', background: [] } as never,
        nodes: [],
        seq: 0,
      };
    });
    vi.mocked(window.api.chat.latestForTask).mockResolvedValue({
      info: { id: 'chat-earlier', agent: 'codex', sandbox: null },
    } as never);

    expect(await terminalOp({ action: 'open', projectPath: PROJECT, taskNumber: 4, resume: true })).toEqual({
      ok: true,
      ptyId: 'chat-earlier',
    });
    expect(window.api.chat.start).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'chat-earlier', agent: 'codex' }),
    );
    expect(useTerminalStore.getState().displayStates['chat-earlier']).toMatchObject({ surface: 'chat', taskId: 4 });

    // With no conversation to pick up, a new one opens, named before it does.
    vi.mocked(window.api.chat.latestForTask).mockResolvedValue(null);
    const fresh = await terminalOp({ action: 'open', projectPath: PROJECT, taskNumber: 4, resume: true });
    expect(fresh.ok).toBe(true);
    expect(window.api.chat.start).toHaveBeenLastCalledWith(expect.objectContaining({ id: fresh.ptyId }));
    vi.mocked(window.api.globalSettings.get).mockResolvedValue(undefined);
  });

  test('a runner the user ran privately cannot be read by its own id either', async () => {
    const front = terminalInstances.get('pty-front')!;
    const child = { isRunner: true, xterm: { buffer: { active: { type: 'normal' } } } } as unknown as OuijitTerminal;
    front.panels.push({ id: 'panel-s', kind: 'runner', status: 'success', private: true } as never);
    front.runnerChildren.set('panel-s', child);
    terminalInstances.set('pty-runner', child);

    expect(await terminalOp({ action: 'read', ptyId: 'pty-runner' })).toEqual({
      ok: false,
      error: 'The user ran this privately',
    });
    terminalInstances.delete('pty-runner');
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
    expect(vi.mocked(window.api.pty.spawn).mock.lastCall?.[0]).toEqual(expect.objectContaining({ sandbox: 'nono' }));

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

    // A link brings a panel forward, and says so when the panel it names has closed.
    useAppStore.setState({ projects: [{ path: PROJECT, name: 'alpha' } as never] });
    await openLink('ouijit://alpha/terminals/pty-front/panels/panel-2');
    expect(terminalInstances.get('pty-front')?.activePanelId).toBe('panel-2');

    const removed = await panelOp({ ptyId: 'pty-front', action: 'remove', kind: 'runner', value: 'scr-1' });
    expect(removed.panels).toEqual([]);
    await openLink('ouijit://alpha/terminals/pty-front/panels/panel-1');
    expect(useProjectStore.getState().toasts.map((t) => t.message)).toContain('That panel was closed');
    expect(await panelOp({ ptyId: 'pty-front', action: 'add', kind: 'runner', value: 'nope' })).toEqual({
      ok: false,
      error: 'No script named nope',
    });
  });
});

describe('opening a link to a task', () => {
  test("opens a started task's terminal and shows it, as its row does, and never starts one", async () => {
    window.api.task.getAll = vi.fn().mockResolvedValue([started, neverStarted]);
    useAppStore.setState({
      projects: [{ path: PROJECT, name: PROJECT.split('/').pop() } as never],
      taskCacheByProject: { [PROJECT]: [started, neverStarted] },
      selection: { kind: 'none' },
    });
    spawned.next = ['pty-task'];
    const name = PROJECT.split('/').pop();

    await openLink(`ouijit://${name}/tasks/4`);
    expect(spawned.calls.at(-1)).toEqual(expect.objectContaining({ cwd: '/wt/T-4' }));
    expect(useAppStore.getState().selection).toEqual(
      expect.objectContaining({ kind: 'terminal', projectPath: PROJECT }),
    );
    expect(useTerminalStore.getState().order[0]).toBe('pty-task');

    await openLink(`ouijit://${name}/tasks/9`);
    expect(useAppStore.getState().selection).toEqual({ kind: 'page', projectPath: PROJECT, page: 'board' });
    expect(window.api.task.start).not.toHaveBeenCalled();

    // A link to a project Ouijit doesn't have goes nowhere.
    await openLink('ouijit://elsewhere/tasks/4');
    expect(useAppStore.getState().selection).toEqual({ kind: 'page', projectPath: PROJECT, page: 'board' });
  });
});
