import { describe, test, expect, beforeEach, vi } from 'vitest';

vi.mock('electron-log/renderer', () => ({
  default: { scope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// Stand-in for the xterm-backed terminal module. terminalActions reaches the
// same `terminalInstances` map the test does (imported back below). The fake
// OuijitTerminal records the lifecycle calls reconnectRunnerToParent makes so
// we can assert the runner reattaches to its parent rather than becoming a card.
vi.mock('../../components/terminal/terminalReact', () => {
  class FakeTerminal {
    ptyId?: string;
    label?: string;
    isRunner: boolean;
    runnerStatus: string | null = null;
    runnerCommand: string | null = null;
    setRunner = vi.fn();
    pushDisplayState = vi.fn();
    openTerminal = vi.fn();
    replayBuffer = vi.fn();
    bind = vi.fn();
    dispose = vi.fn();
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

interface FakeTerminal {
  ptyId?: string;
  runnerStatus: string | null;
  setRunner: ReturnType<typeof vi.fn>;
}

function makeParent(ptyId: string): FakeTerminal {
  const parent = new (OuijitTerminal as unknown as new (o: { ptyId: string }) => FakeTerminal)({ ptyId });
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
  test('reattaches the runner to its parent as panel state, not a standalone card', async () => {
    const parent = makeParent('parent-1');

    const ok = await reconnectRunnerToParent(runnerSession());

    expect(ok).toBe(true);
    // Runner state lands on the parent...
    expect(parent.setRunner).toHaveBeenCalledTimes(1);
    expect(parent.runnerStatus).toBe('running');
    // ...and the runner is NOT promoted to its own card in the stack.
    const stack = useTerminalStore.getState().terminalsByProject[PROJECT] ?? [];
    expect(stack).not.toContain('runner-1');
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
