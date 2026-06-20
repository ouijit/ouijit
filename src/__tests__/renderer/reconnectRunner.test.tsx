import { describe, test, expect, beforeEach, vi } from 'vitest';

vi.mock('electron-log/renderer', () => ({
  default: { scope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// Stand-in for the xterm-backed terminal module. terminalActions reaches the
// same `terminalInstances` map the test does (imported back below). The fake
// OuijitTerminal records the lifecycle calls reconnectRunnerToParent makes so
// we can assert the runner reattaches to its parent rather than becoming a card.
vi.mock('../../components/terminal/terminalReact', () => {
  interface FakePanel {
    id: string;
    kind: string;
    scriptName: string | null;
    scriptCommand: string | null;
    command: string | null;
    status: string;
  }
  class FakeTerminal {
    ptyId?: string;
    label?: string;
    isRunner: boolean;
    panels: FakePanel[] = [];
    runnerChildren = new Map<string, unknown>();
    openTerminal = vi.fn();
    replayBuffer = vi.fn();
    bind = vi.fn();
    dispose = vi.fn();
    setRunnerChild = vi.fn((id: string, runner: unknown) => {
      this.runnerChildren.set(id, runner);
    });
    updatePanel = vi.fn((id: string, patch: Record<string, unknown>) => {
      const p = this.panels.find((x) => x.id === id);
      if (p) Object.assign(p, patch);
    });
    addRunnerPanel = vi.fn((script?: { name: string; command: string } | null) => {
      const id = `panel-${this.panels.length}`;
      this.panels.push({
        id,
        kind: 'runner',
        scriptName: script?.name ?? null,
        scriptCommand: script?.command ?? null,
        command: script?.command ?? null,
        status: 'idle',
      });
      return id;
    });
    constructor(opts: { ptyId?: string; label?: string; isRunner?: boolean }) {
      this.ptyId = opts.ptyId;
      this.label = opts.label;
      this.isRunner = opts.isRunner ?? false;
    }
  }
  return {
    terminalInstances: new Map(),
    OuijitTerminal: FakeTerminal,
    resolveTerminalLabel: (taskName?: string | null, branch?: string, fallback?: string) =>
      taskName || branch || fallback || 'Shell',
  };
});

import { reconnectRunnerToParent } from '../../components/terminal/terminalActions';
import { terminalInstances, OuijitTerminal } from '../../components/terminal/terminalReact';
import { useTerminalStore } from '../../stores/terminalStore';
import type { ActiveSession } from '../../types';

const PROJECT = '/project';

interface FakeParent {
  ptyId?: string;
  panels: Array<{ id: string; kind: string; status: string }>;
  runnerChildren: Map<string, unknown>;
  setRunnerChild: ReturnType<typeof vi.fn>;
}

function makeParent(ptyId: string): FakeParent {
  const parent = new (OuijitTerminal as unknown as new (o: { ptyId: string }) => FakeParent)({ ptyId });
  terminalInstances.set(ptyId, parent as never);
  return parent;
}

function runnerSession(over: Partial<ActiveSession> = {}): ActiveSession {
  return {
    ptyId: 'runner-1',
    projectPath: PROJECT,
    command: 'npm run dev',
    label: 'run hook',
    isRunner: true,
    parentPtyId: 'parent-1',
    ...over,
  } as ActiveSession;
}

beforeEach(() => {
  vi.clearAllMocks();
  terminalInstances.clear();
  useTerminalStore.setState({ terminalsByProject: {}, displayStates: {} } as never);
  (window.api.pty.reconnect as ReturnType<typeof vi.fn>).mockResolvedValue({
    success: true,
    bufferedOutput: '',
    lastCols: 80,
    isAltScreen: false,
  });
});

describe('reconnectRunnerToParent', () => {
  test('reattaches the runner to its parent as a runner panel, not a standalone card', async () => {
    const parent = makeParent('parent-1');

    const ok = await reconnectRunnerToParent(runnerSession());

    expect(ok).toBe(true);
    // Runner state lands on the parent as a running runner panel...
    expect(parent.setRunnerChild).toHaveBeenCalledTimes(1);
    expect(parent.panels).toHaveLength(1);
    expect(parent.panels[0]).toMatchObject({ kind: 'runner', status: 'running' });
    // ...and the runner is NOT promoted to its own card in the stack.
    const stack = useTerminalStore.getState().terminalsByProject[PROJECT] ?? [];
    expect(stack).not.toContain('runner-1');
  });

  test('attaches to an existing idle runner panel matching the command', async () => {
    const parent = makeParent('parent-1') as FakeParent & {
      addRunnerPanel: (s?: { name: string; command: string }) => string;
    };
    // A runner panel preloaded from the restored snapshot (idle, no live child).
    const panelId = parent.addRunnerPanel({ name: 'dev', command: 'npm run dev' });

    const ok = await reconnectRunnerToParent(runnerSession());

    expect(ok).toBe(true);
    // No new panel was created — it reused the idle one.
    expect(parent.panels).toHaveLength(1);
    expect(parent.runnerChildren.has(panelId)).toBe(true);
    expect(parent.panels[0].status).toBe('running');
  });

  test('does not promote the runner to a standalone card when the parent is missing', async () => {
    // Parent never reconnected (e.g. wrong ordering) — leave the runner orphaned
    // rather than spawning a bogus "run hook" card.
    const ok = await reconnectRunnerToParent(runnerSession({ parentPtyId: 'absent' }));

    expect(ok).toBe(false);
    expect(window.api.pty.reconnect).not.toHaveBeenCalled();
    const stack = useTerminalStore.getState().terminalsByProject[PROJECT] ?? [];
    expect(stack).not.toContain('runner-1');
  });
});
