/**
 * `ouijit markdown` / `ouijit preview` reach a terminal through the global
 * instance registry, so the panel listener is installed once for the window
 * rather than mounted by a view — a terminal shown on the home view answers
 * the same ops as one on its project view.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { installCliPanelListener } from '../../services/cliPanelListener';
import { terminalInstances } from '../../components/terminal/terminalReact';
import type { CliPanelOp, CliPanelResponse } from '../../types';

// terminalReact pulls in xterm, which cannot construct under jsdom.
vi.mock('../../components/terminal/terminalReact', () => ({
  terminalInstances: new Map(),
}));

type Panel = { id: string; kind: 'plan' | 'webPreview'; planPath?: string; url?: string };

/** The panel surface the listener drives, with the real activate/close semantics. */
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

const registry = terminalInstances as unknown as Map<string, FakeTerminal>;

let sendOp: (op: CliPanelOp) => void;
let requestId = 0;

/** Fire an op at the installed listener and return the reply it sent back. */
function run(op: Omit<CliPanelOp, 'requestId'>): CliPanelResponse {
  sendOp({ requestId: ++requestId, ...op });
  const calls = vi.mocked(window.api.cliPanels.respond).mock.calls;
  const last = calls.at(-1);
  expect(last?.[0]).toBe(requestId);
  return last![1];
}

describe('CLI panel listener', () => {
  beforeEach(() => {
    registry.clear();
    vi.mocked(window.api.cliPanels.respond).mockClear();
    vi.mocked(window.api.cliPanels.onOp)
      .mockReset()
      .mockImplementation((cb) => {
        sendOp = cb;
        return () => {};
      });
    installCliPanelListener();
  });

  it('adds, lists, and removes panels on any live terminal', () => {
    const term = new FakeTerminal();
    registry.set('pty-home', term);

    const added = run({ ptyId: 'pty-home', action: 'add', kind: 'markdown', value: '/notes.md' });
    expect(added).toEqual({
      ok: true,
      panels: [{ kind: 'markdown', label: 'notes.md', path: '/notes.md', active: true }],
    });

    // A second add of the same file surfaces the panel it already has.
    run({ ptyId: 'pty-home', action: 'add', kind: 'preview', value: 'http://localhost:3000' });
    run({ ptyId: 'pty-home', action: 'add', kind: 'markdown', value: '/notes.md' });
    expect(term.panels).toHaveLength(2);
    expect(term.activePanelId).toBe('panel-1');

    // Listing is scoped to the kind asked for.
    const listed = run({ ptyId: 'pty-home', action: 'list', kind: 'preview' });
    expect(listed.panels).toEqual([
      { kind: 'preview', label: 'localhost:3000', url: 'http://localhost:3000', active: false },
    ]);

    expect(run({ ptyId: 'pty-home', action: 'remove', kind: 'markdown', value: '/notes.md' })).toEqual({
      ok: true,
      panels: [],
    });
    expect(term.panels.map((p) => p.kind)).toEqual(['webPreview']);

    const gone = run({ ptyId: 'pty-home', action: 'remove', kind: 'markdown', value: '/notes.md' });
    expect(gone.ok).toBe(false);
    expect(gone.error).toContain('/notes.md');
  });

  it('names the session and how to get it back when no terminal holds it', () => {
    const reply = run({ ptyId: 'pty-orphan', action: 'add', kind: 'markdown', value: '/notes.md' });
    expect(reply.ok).toBe(false);
    expect(reply.error).toContain('pty-orphan');
    expect(reply.error).toMatch(/home view/);
  });
});
