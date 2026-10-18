import { describe, test, expect, beforeEach, vi } from 'vitest';

import { gatherSnapshot, SNAPSHOT_KEY } from '../../components/terminal/sessionSnapshot';
import { reconnectOrphanedSessions, renameTerminal } from '../../components/terminal/terminalActions';
import { terminalInstances } from '../../components/terminal/terminalRegistry';
import { HOME_STACK, getActivePtyId, useTerminalStore, visibleStack } from '../../stores/terminalStore';
import { useAppStore } from '../../stores/appStore';
import type { OuijitTerminal } from '../../components/terminal/terminalReact';
import type { ActiveSession, LastSessionSnapshot } from '../../types';

// Replace terminalReact (xterm under the hood) with a stand-in that keeps the
// state the snapshot reads and the reconnect writes.
vi.mock('../../components/terminal/terminalReact', () => ({
  OuijitTerminal: class {
    panels: unknown[] = [];
    activePanelId: string | null = null;
    panelFullWidth = true;
    diffPanelOpen = false;
    isRunner = false;
    xterm = { focus: () => {} };
    constructor(opts: Record<string, unknown>) {
      Object.assign(this, opts);
    }
    openTerminal() {}
    replayBuffer() {}
    suppressResizeDuring() {}
    bind() {}
    loadTags() {}
    refreshGitStatus() {}
    setProjectNameGetter() {}
    syncPanels() {}
    pushDisplayState() {}
    dispose() {}
  },
  resolveTerminalLabel: (taskName?: string | null, branch?: string, fallback?: string) =>
    taskName || branch || fallback || 'Shell',
}));

const A = '/project-a';
const B = '/project-b';

interface FakeTermOpts {
  ptyId: string;
  label?: string;
  isRunner?: boolean;
  taskId?: number | null;
  planPath?: string;
  diffPanelOpen?: boolean;
  previewUrl?: string;
}

function makeFakeTerm(projectPath: string, opts: FakeTermOpts): OuijitTerminal {
  const panels: Array<Record<string, unknown>> = [];
  if (opts.planPath) panels.push({ id: 'plan', kind: 'plan', planPath: opts.planPath });
  if (opts.previewUrl) panels.push({ id: 'prev', kind: 'webPreview', url: opts.previewUrl });
  return {
    ptyId: opts.ptyId,
    projectPath,
    label: opts.label ?? 'Shell',
    isRunner: opts.isRunner ?? false,
    taskId: opts.taskId ?? null,
    panels,
    activePanelId: opts.planPath ? 'plan' : null,
    panelFullWidth: true,
    diffPanelOpen: opts.diffPanelOpen ?? false,
  } as unknown as OuijitTerminal;
}

function open(projectPath: string, opts: FakeTermOpts): void {
  const term = makeFakeTerm(projectPath, opts);
  terminalInstances.set(term.ptyId, term);
  useTerminalStore.getState().addTerminal(projectPath, term.ptyId, { label: term.label, taskId: term.taskId });
}

function session(ptyId: string, projectPath: string): ActiveSession {
  return { ptyId, projectPath, command: undefined, label: 'Shell', isRunner: false } as unknown as ActiveSession;
}

/** A renderer reload: the PTYs live on in the main process, the renderer's state does not. */
async function reload(snapshot: LastSessionSnapshot, sessions: ActiveSession[]): Promise<void> {
  terminalInstances.clear();
  useTerminalStore.setState(useTerminalStore.getInitialState(), true);
  vi.mocked(window.api.globalSettings.get).mockImplementation(async (key) =>
    key === SNAPSHOT_KEY ? JSON.stringify(snapshot) : undefined,
  );
  vi.mocked(window.api.pty.getActiveSessions).mockResolvedValue(sessions);
  vi.mocked(window.api.pty.reconnect).mockResolvedValue({ success: true } as never);
  await reconnectOrphanedSessions();
}

beforeEach(() => {
  terminalInstances.clear();
  useTerminalStore.setState(useTerminalStore.getInitialState(), true);
  useAppStore.setState({ activeProjectPath: A });
  vi.clearAllMocks();
});

describe('session persistence', () => {
  test('a reload reconnects every terminal in the order it was used, with its panels', async () => {
    open(A, { ptyId: 'a', label: 'Build' });
    open(A, { ptyId: 'b', label: 'My Renamed Tab', taskId: 7, planPath: '/plan.md' });
    open(B, { ptyId: 'c', label: 'shell', diffPanelOpen: true });
    open(A, { ptyId: 'runner', isRunner: true });
    useTerminalStore.getState().activate('a');
    useTerminalStore.getState().activate('b');

    const snapshot = gatherSnapshot();
    expect(snapshot.activeProjectPath).toBe(A);
    expect(snapshot.terminals.map((t) => [t.ptyId, t.recencyRank, t.isActiveInProject])).toEqual([
      ['b', 0, true],
      ['a', 1, false],
      ['c', 2, true],
    ]);
    expect(snapshot.terminals[0]).toMatchObject({ label: 'My Renamed Tab', taskNumber: 7 });
    expect(snapshot.terminals[0].ui.panels).toEqual([{ kind: 'plan', planPath: '/plan.md' }]);
    // Diff is automatic/separate — persisted as its own flag, not a panel tab.
    expect(snapshot.terminals[2].ui).toMatchObject({ panels: [], diffPanelOpen: true });

    // Sessions come back in the order they were spawned, not the order they were used.
    await reload(snapshot, [session('a', A), session('b', A), session('c', B), session('stray', B)]);

    expect(visibleStack(useTerminalStore.getState(), HOME_STACK)).toEqual(['b', 'a', 'c', 'stray']);
    expect(getActivePtyId(A)).toBe('b');
    expect(getActivePtyId(B)).toBe('c');
    expect(useTerminalStore.getState().displayStates['b'].label).toBe('My Renamed Tab');
    expect(terminalInstances.get('b')?.panels).toEqual([
      expect.objectContaining({ kind: 'plan', planPath: '/plan.md' }),
    ]);
  });

  test('a snapshot written before recency was recorded keeps each project in creation order, active first', async () => {
    const row = (ptyId: string, projectPath: string, ordinalInProject: number, isActiveInProject: boolean) => ({
      ptyId,
      projectPath,
      taskNumber: null,
      worktreePath: null,
      worktreeBranch: null,
      label: null,
      ordinalInProject,
      isActiveInProject,
      ui: {},
    });
    const snapshot: LastSessionSnapshot = {
      version: 1,
      capturedAt: new Date().toISOString(),
      activeProjectPath: B,
      terminals: [row('a1', A, 0, false), row('a2', A, 1, true), row('a3', A, 2, false), row('b1', B, 0, true)],
    };

    await reload(snapshot, [session('a1', A), session('a2', A), session('a3', A), session('b1', B)]);

    expect(visibleStack(useTerminalStore.getState(), HOME_STACK)).toEqual(['b1', 'a2', 'a1', 'a3']);
    expect(getActivePtyId(A)).toBe('a2');
  });
});

describe('renameTerminal', () => {
  test('writes through to display state, the terminal instance, and the PTY record, and ignores a blank name', () => {
    open(A, { ptyId: 'x', label: 'old-branch-name' });

    renameTerminal('x', '  Auth refactor  ');
    renameTerminal('x', '   ');

    expect(terminalInstances.get('x')?.label).toBe('Auth refactor');
    expect(useTerminalStore.getState().displayStates['x'].label).toBe('Auth refactor');
    expect(window.api.pty.setLabel).toHaveBeenCalledTimes(1);
    expect(window.api.pty.setLabel).toHaveBeenCalledWith('x', 'Auth refactor');
    expect(gatherSnapshot().terminals[0]).toMatchObject({ ptyId: 'x', label: 'Auth refactor' });
  });
});
