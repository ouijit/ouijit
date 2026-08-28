/**
 * `ouijit markdown` / `ouijit preview` reach a terminal through the global
 * instance registry, so the panel listener is installed once for the window
 * rather than mounted by a view — a terminal shown on the home view answers
 * the same ops as one on its project view, and one still reconnecting after a
 * reload answers once it is back.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { installCliPanelListener } from '../../services/cliPanelListener';
import { terminalInstances, registerTerminalInstance, trackRestore } from '../../components/terminal/terminalRegistry';
import type { OuijitTerminal } from '../../components/terminal/terminalReact';
import type { CliPanelOp, CliPanelResponse } from '../../types';

/** Matches `TERMINAL_WAIT_MS` in the listener. */
const TERMINAL_WAIT_MS = 3000;

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
  registerTerminalInstance(ptyId, term as unknown as OuijitTerminal);
}

let sendOp: (op: CliPanelOp) => void;
let requestId = 0;

/**
 * Fire an op at the installed listener and return the reply it sent back.
 * `during` runs while the op is in flight, before the wait for a terminal.
 */
async function run(
  op: Omit<CliPanelOp, 'requestId'>,
  during?: () => Promise<void> | void,
): Promise<CliPanelResponse> {
  const id = ++requestId;
  sendOp({ requestId: id, ...op });
  await during?.();
  await vi.advanceTimersByTimeAsync(TERMINAL_WAIT_MS);
  const last = vi.mocked(window.api.cliPanels.respond).mock.calls.at(-1);
  expect(last?.[0]).toBe(id);
  return last![1];
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
    trackRestore(
      'pty-reloading',
      new Promise<void>((resolve) => {
        finishRestore = () => {
          // The snapshot restore replaces panels wholesale, so an op applied
          // before it lands would be thrown away.
          term.panels = [];
          resolve();
        };
      }),
    );

    const reply = await run(
      { ptyId: 'pty-reloading', action: 'add', kind: 'markdown', value: '/notes.md' },
      async () => {
        register('pty-reloading', term);
        await vi.advanceTimersByTimeAsync(0); // let the op get as far as it can
        finishRestore();
      },
    );

    expect(reply).toEqual({
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
