import { describe, test, expect, beforeEach, vi } from 'vitest';

vi.mock('electron-log/renderer', () => ({
  default: { scope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// Fake terminal standing in for OuijitTerminal. Only the fields
// killExistingCommandInstances touches are modelled: the runner panels it may
// close, its live runner children, its worktree (the scoping key), and the
// startup command used by the whole-terminal kill loop.
vi.mock('../../components/terminal/terminalReact', () => {
  interface FakePanel {
    id: string;
    kind: string;
    command: string | null;
    scriptCommand: string | null;
  }
  class FakeTerminal {
    ptyId: string;
    projectPath = '/project';
    worktreePath?: string;
    command?: string;
    panels: FakePanel[] = [];
    runnerChildren = new Map<string, unknown>();
    closePanel = vi.fn((id: string) => {
      this.panels = this.panels.filter((p) => p.id !== id);
    });
    dispose = vi.fn();
    constructor(opts: { ptyId: string; worktreePath?: string; command?: string }) {
      this.ptyId = opts.ptyId;
      this.worktreePath = opts.worktreePath;
      this.command = opts.command;
    }
  }
  return { terminalInstances: new Map(), OuijitTerminal: FakeTerminal };
});

import { killExistingCommandInstances } from '../../components/terminal/terminalActions';
import { terminalInstances, OuijitTerminal } from '../../components/terminal/terminalReact';
import { useTerminalStore } from '../../stores/terminalStore';

const PROJECT = '/project';
const COMMAND = 'npm run dev';

interface Fake {
  ptyId: string;
  worktreePath?: string;
  command?: string;
  panels: Array<{ id: string; kind: string; command: string | null; scriptCommand: string | null }>;
  runnerChildren: Map<string, unknown>;
  closePanel: ReturnType<typeof vi.fn>;
}

function makeTerminal(opts: { ptyId: string; worktreePath?: string; command?: string }): Fake {
  const term = new (OuijitTerminal as unknown as new (o: typeof opts) => Fake)(opts);
  terminalInstances.set(opts.ptyId, term as never);
  const ids = useTerminalStore.getState().terminalsByProject[PROJECT] ?? [];
  useTerminalStore.setState({ terminalsByProject: { [PROJECT]: [...ids, opts.ptyId] } } as never);
  return term;
}

// Give a terminal a live runner panel for COMMAND (has a running child).
function addRunningRunner(term: Fake, panelId: string): void {
  term.panels.push({ id: panelId, kind: 'runner', command: COMMAND, scriptCommand: COMMAND });
  term.runnerChildren.set(panelId, {});
}

beforeEach(() => {
  vi.clearAllMocks();
  terminalInstances.clear();
  useTerminalStore.setState({ terminalsByProject: {}, displayStates: {} } as never);
});

describe('killExistingCommandInstances', () => {
  test('does not close a runner panel running the same command in a different worktree', () => {
    const taskA = makeTerminal({ ptyId: 'pty-a', worktreePath: '/wt/a' });
    addRunningRunner(taskA, 'a-runner');

    const taskB = makeTerminal({ ptyId: 'pty-b', worktreePath: '/wt/b' });
    addRunningRunner(taskB, 'b-runner');

    // Task B (re)starts its own runner — the launching panel is excepted.
    killExistingCommandInstances(PROJECT, COMMAND, '/wt/b', 'b-runner');

    expect(taskA.closePanel).not.toHaveBeenCalled();
    expect(taskB.closePanel).not.toHaveBeenCalled();
  });

  test('closes a duplicate runner panel running the same command in the same worktree', () => {
    const stale = makeTerminal({ ptyId: 'pty-stale', worktreePath: '/wt/b' });
    addRunningRunner(stale, 'stale-runner');

    const launching = makeTerminal({ ptyId: 'pty-b', worktreePath: '/wt/b' });
    addRunningRunner(launching, 'b-runner');

    killExistingCommandInstances(PROJECT, COMMAND, '/wt/b', 'b-runner');

    expect(stale.closePanel).toHaveBeenCalledWith('stale-runner');
    // The launching panel itself is never closed.
    expect(launching.closePanel).not.toHaveBeenCalled();
  });

  test('project-root terminals (no worktree) still dedupe among themselves', () => {
    const first = makeTerminal({ ptyId: 'pty-1' });
    addRunningRunner(first, 'first-runner');

    const launching = makeTerminal({ ptyId: 'pty-2' });
    addRunningRunner(launching, 'second-runner');

    killExistingCommandInstances(PROJECT, COMMAND, undefined, 'second-runner');

    expect(first.closePanel).toHaveBeenCalledWith('first-runner');
  });
});
