import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Terminal } from '@xterm/headless';

import { installCliPanelListener } from '../../services/cliPanelListener';
import { terminalInstances, restoreTerminalOnce } from '../../components/terminal/terminalRegistry';
import type { OuijitTerminal } from '../../components/terminal/terminalReact';
import { TERMINAL_READY_WAIT_MS, type CliPanelOp, type CliPanelResponse } from '../../types';

type Panel = {
  id: string;
  kind: 'plan' | 'webPreview' | 'runner';
  planPath?: string;
  url?: string;
  scriptName?: string;
  status?: string;
  exitCode?: number;
};

/** The slice of `OuijitTerminal`'s panel surface the listener drives. */
class FakeTerminal {
  panels: Panel[] = [];
  activePanelId: string | null = null;
  runnerChildren = new Map<string, { xterm: Terminal }>();
  private nextId = 1;

  private append(panel: Panel, activate: boolean): string {
    this.panels = [...this.panels, panel];
    if (activate) this.activePanelId = panel.id;
    return panel.id;
  }

  addPlanPanel(planPath: string, activate = true): string {
    return this.append({ id: `panel-${this.nextId++}`, kind: 'plan', planPath }, activate);
  }

  addWebPreviewPanel(url: string | null = null, opts?: { activate?: boolean }): string {
    return this.append(
      { id: `panel-${this.nextId++}`, kind: 'webPreview', url: url ?? undefined },
      opts?.activate ?? true,
    );
  }

  activatePanel(id: string): void {
    if (this.panels.some((p) => p.id === id)) this.activePanelId = id;
  }

  closePanel(id: string): void {
    const idx = this.panels.findIndex((p) => p.id === id);
    if (idx === -1) return;
    const remaining = this.panels.filter((p) => p.id !== id);
    if (this.activePanelId === id) {
      this.activePanelId = remaining.length === 0 ? null : remaining[Math.min(idx, remaining.length - 1)].id;
    }
    this.panels = remaining;
  }
}

function register(ptyId: string, term: FakeTerminal): void {
  terminalInstances.set(ptyId, term as unknown as OuijitTerminal);
}

let sendOp: (op: CliPanelOp) => void;
let requestId = 0;

function send(op: Omit<CliPanelOp, 'requestId'>): number {
  const id = ++requestId;
  sendOp({ requestId: id, ...op });
  return id;
}

/** Run out the listener's wait and return the reply it sent for `id`. */
async function settle(id: number): Promise<CliPanelResponse> {
  await vi.advanceTimersByTimeAsync(TERMINAL_READY_WAIT_MS);
  const last = vi.mocked(window.api.cliPanels.respond).mock.calls.at(-1);
  expect(last?.[0]).toBe(id);
  return last![1];
}

function run(op: Omit<CliPanelOp, 'requestId'>): Promise<CliPanelResponse> {
  return settle(send(op));
}

describe('CLI panel listener', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    terminalInstances.clear();
    vi.mocked(window.api.cliPanels.respond).mockClear();
    vi.mocked(window.api.cliPanels.onOp)
      .mockReset()
      .mockImplementation((cb) => {
        sendOp = cb;
        return () => {};
      });
    installCliPanelListener();
  });

  afterEach(() => vi.useRealTimers());

  it('adds, lists, and removes panels, activating what it adds', async () => {
    const term = new FakeTerminal();
    register('pty-home', term);

    const added = await run({ ptyId: 'pty-home', action: 'add', kind: 'markdown', value: '/notes.md' });
    expect(added).toEqual({
      ok: true,
      panels: [{ id: 'panel-1', kind: 'markdown', label: 'notes.md', path: '/notes.md', active: true }],
    });

    // A second add of the same file surfaces the panel it already has.
    await run({ ptyId: 'pty-home', action: 'add', kind: 'preview', value: 'http://localhost:3000' });
    await run({ ptyId: 'pty-home', action: 'add', kind: 'markdown', value: '/notes.md' });
    expect(term.panels).toHaveLength(2);
    expect(term.activePanelId).toBe('panel-1');

    // Listing is scoped to the kind asked for.
    const listed = await run({ ptyId: 'pty-home', action: 'list', kind: 'preview' });
    expect(listed.panels).toEqual([
      { id: 'panel-2', kind: 'preview', label: 'localhost:3000', url: 'http://localhost:3000', active: false },
    ]);

    expect(await run({ ptyId: 'pty-home', action: 'remove', kind: 'markdown', value: '/notes.md' })).toEqual({
      ok: true,
      panels: [],
    });
    expect(term.panels.map((p) => p.kind)).toEqual(['webPreview']);

    const gone = await run({ ptyId: 'pty-home', action: 'remove', kind: 'markdown', value: '/notes.md' });
    expect(gone.ok).toBe(false);
    expect(gone.error).toContain('/notes.md');
  });

  it("reads a runner's screen, status and exit code, and where any other panel points", async () => {
    const term = new FakeTerminal();
    register('pty-agent', term);
    const runner = new Terminal({ cols: 40, rows: 5, allowProposedApi: true });
    const written = new Promise<void>((done) => runner.write('1 failing\r\n  ✗ refresh keeps the session\r\n', done));
    await vi.advanceTimersByTimeAsync(50);
    await written;
    term.panels = [
      { id: 'panel-r', kind: 'runner', scriptName: 'Tests', status: 'error', exitCode: 1 },
      { id: 'panel-p', kind: 'plan', planPath: '/wt/plan.md' },
    ];
    term.runnerChildren.set('panel-r', { xterm: runner });

    expect(await run({ ptyId: 'pty-agent', action: 'read', value: 'panel-r', lines: 1 })).toEqual({
      ok: true,
      read: { kind: 'runner', text: '  ✗ refresh keeps the session', status: 'error', exitCode: 1 },
    });
    expect(await run({ ptyId: 'pty-agent', action: 'read', value: 'panel-p' })).toEqual({
      ok: true,
      read: { kind: 'markdown', path: '/wt/plan.md' },
    });
    expect(await run({ ptyId: 'pty-agent', action: 'read', value: 'panel-x' })).toEqual({
      ok: false,
      error: 'No panel panel-x',
    });
  });

  it('holds an op until a reconnecting terminal has finished restoring', async () => {
    const term = new FakeTerminal();
    let finishRestore!: () => void;
    const restored = new Promise<void>((resolve) => {
      finishRestore = resolve;
    });
    void restoreTerminalOnce('pty-reloading', async () => {
      register('pty-reloading', term); // the terminal binds partway through
      await restored;
      term.panels = []; // ...and the snapshot then replaces its panels wholesale
    });

    const id = send({ ptyId: 'pty-reloading', action: 'add', kind: 'markdown', value: '/notes.md' });
    await vi.advanceTimersByTimeAsync(1000); // long enough to act on a half-restored terminal
    finishRestore();

    expect(await settle(id)).toEqual({
      ok: true,
      panels: [{ id: 'panel-1', kind: 'markdown', label: 'notes.md', path: '/notes.md', active: true }],
    });
    expect(term.panels).toHaveLength(1);
  });

  it('gives up on a session no terminal claims, naming it', async () => {
    const reply = await run({ ptyId: 'pty-orphan', action: 'add', kind: 'markdown', value: '/notes.md' });
    expect(reply.ok).toBe(false);
    expect(reply.error).toContain('pty-orphan');
  });
});
