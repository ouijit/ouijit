import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { installCliPanelListener } from '../../services/cliPanelListener';
import { terminalInstances, restoreTerminalOnce } from '../../components/terminal/terminalRegistry';
import type { OuijitTerminal } from '../../components/terminal/terminalReact';
import { CLI_PANEL_TERMINAL_WAIT_MS, type CliPanelOp, type CliPanelResponse } from '../../types';

type Panel = { id: string; kind: 'plan' | 'webPreview'; planPath?: string; url?: string };

/** The slice of `OuijitTerminal`'s panel surface the listener drives. */
class FakeTerminal {
  panels: Panel[] = [];
  activePanelId: string | null = null;
  private nextId = 1;

  private append(panel: Panel): string {
    this.panels = [...this.panels, panel];
    this.activePanelId = panel.id;
    return panel.id;
  }

  addPlanPanel(planPath: string): string {
    return this.append({ id: `panel-${this.nextId++}`, kind: 'plan', planPath });
  }

  addWebPreviewPanel(url: string): string {
    return this.append({ id: `panel-${this.nextId++}`, kind: 'webPreview', url });
  }

  activatePanel(id: string): void {
    if (this.panels.some((p) => p.id === id)) this.activePanelId = id;
  }

  closePanel(id: string): void {
    this.panels = this.panels.filter((p) => p.id !== id);
    if (this.activePanelId === id) this.activePanelId = this.panels.at(-1)?.id ?? null;
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
  await vi.advanceTimersByTimeAsync(CLI_PANEL_TERMINAL_WAIT_MS);
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

  it('adds, lists, and removes panels on any live terminal', async () => {
    const term = new FakeTerminal();
    register('pty-home', term);

    const added = await run({ ptyId: 'pty-home', action: 'add', kind: 'markdown', value: '/notes.md' });
    expect(added).toEqual({
      ok: true,
      panels: [{ kind: 'markdown', label: 'notes.md', path: '/notes.md', active: true }],
    });

    // A second add of the same file surfaces the panel it already has.
    await run({ ptyId: 'pty-home', action: 'add', kind: 'preview', value: 'http://localhost:3000' });
    await run({ ptyId: 'pty-home', action: 'add', kind: 'markdown', value: '/notes.md' });
    expect(term.panels).toHaveLength(2);
    expect(term.activePanelId).toBe('panel-1');

    // Listing is scoped to the kind asked for.
    const listed = await run({ ptyId: 'pty-home', action: 'list', kind: 'preview' });
    expect(listed.panels).toEqual([
      { kind: 'preview', label: 'localhost:3000', url: 'http://localhost:3000', active: false },
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
      panels: [{ kind: 'markdown', label: 'notes.md', path: '/notes.md', active: true }],
    });
    expect(term.panels).toHaveLength(1);
  });

  it('names the session and how to get it back when no terminal holds it', async () => {
    const reply = await run({ ptyId: 'pty-orphan', action: 'add', kind: 'markdown', value: '/notes.md' });
    expect(reply.ok).toBe(false);
    expect(reply.error).toContain('pty-orphan');
    expect(reply.error).toMatch(/home view/);
  });
});
