import { describe, test, expect, beforeEach, vi } from 'vitest';

// electron-log/renderer expects an Electron host; stub it to a no-op logger.
vi.mock('electron-log/renderer', () => ({
  default: { scope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// Replace terminalReact (xterm under the hood) with a thin stand-in. Both
// sessionSnapshot.ts and terminalActions.ts import from it; the test reaches
// the same `terminalInstances` map they do.
vi.mock('../../components/terminal/terminalReact', () => ({
  terminalInstances: new Map(),
  OuijitTerminal: class {},
  resolveTerminalLabel: (taskName?: string | null, branch?: string, fallback?: string) =>
    taskName || branch || fallback || 'Shell',
}));

import { gatherSnapshot } from '../../components/terminal/sessionSnapshot';
import { renameTerminal } from '../../components/terminal/terminalActions';
import { terminalInstances } from '../../components/terminal/terminalReact';
import { useTerminalStore } from '../../stores/terminalStore';
import { useAppStore } from '../../stores/appStore';
import type { OuijitTerminal } from '../../components/terminal/terminalReact';

const PROJECT = '/project';

interface FakeTermOpts {
  ptyId: string;
  label?: string;
  isRunner?: boolean;
  taskId?: number | null;
  worktreePath?: string | null;
  worktreeBranch?: string | null;
  planPath?: string | null;
  planPanelOpen?: boolean;
  diffPanelOpen?: boolean;
  /** A preview URL that was auto-detected by a runner (should not persist). */
  autoPreviewUrl?: string | null;
}

function makeFakeTerm(opts: FakeTermOpts): OuijitTerminal {
  const panels: Array<Record<string, unknown>> = [];
  let activePanelId: string | null = null;
  if (opts.planPath) {
    panels.push({ id: 'plan', kind: 'plan', planPath: opts.planPath });
    if (opts.planPanelOpen) activePanelId = 'plan';
  }
  if (opts.autoPreviewUrl) {
    panels.push({
      id: 'prev',
      kind: 'webPreview',
      url: opts.autoPreviewUrl,
      urlAutoDetected: true,
      sourceRunnerPanelId: 'r',
    });
  }
  return {
    ptyId: opts.ptyId,
    label: opts.label ?? 'Shell',
    isRunner: opts.isRunner ?? false,
    sandboxed: false,
    taskId: opts.taskId ?? null,
    worktreePath: opts.worktreePath ?? undefined,
    worktreeBranch: opts.worktreeBranch ?? undefined,
    panels,
    activePanelId,
    panelFullWidth: true,
    diffPanelOpen: opts.diffPanelOpen ?? false,
  } as unknown as OuijitTerminal;
}

function register(projectPath: string, term: OuijitTerminal): void {
  terminalInstances.set(term.ptyId, term);
  const cur = useTerminalStore.getState().terminalsByProject[projectPath] ?? [];
  useTerminalStore.setState({
    terminalsByProject: { ...useTerminalStore.getState().terminalsByProject, [projectPath]: [...cur, term.ptyId] },
    displayStates: {
      ...useTerminalStore.getState().displayStates,
      [term.ptyId]: { ptyId: term.ptyId, projectPath, label: term.label } as never,
    },
  });
}

beforeEach(() => {
  terminalInstances.clear();
  useTerminalStore.setState({ terminalsByProject: {}, displayStates: {}, activeIndices: {} });
  useAppStore.setState({ activeProjectPath: PROJECT });
  vi.clearAllMocks();
});

describe('gatherSnapshot', () => {
  test('captures ptyId, the (renamed) label, panel state and which card is active', () => {
    register(PROJECT, makeFakeTerm({ ptyId: 'a', label: 'Build' }));
    register(
      PROJECT,
      makeFakeTerm({ ptyId: 'b', label: 'My Renamed Tab', taskId: 7, planPath: '/plan.md', planPanelOpen: true }),
    );
    register(PROJECT, makeFakeTerm({ ptyId: 'c', label: 'shell', diffPanelOpen: true }));
    useTerminalStore.getState().setActiveIndex(PROJECT, 1);

    const snap = gatherSnapshot();
    expect(snap.activeProjectPath).toBe(PROJECT);
    expect(snap.terminals).toHaveLength(3);

    const [t0, t1, t2] = snap.terminals;
    expect(t0).toMatchObject({ ptyId: 'a', label: 'Build', isActiveInProject: false });
    expect(t1).toMatchObject({ ptyId: 'b', label: 'My Renamed Tab', taskNumber: 7, isActiveInProject: true });
    expect(t1.ui.panels).toEqual([{ kind: 'plan', planPath: '/plan.md' }]);
    expect(t1.ui.activePanelIndex).toBe(0);
    expect(t2).toMatchObject({ ptyId: 'c', isActiveInProject: false });
    // Diff is automatic/separate — persisted as its own flag, not a panel tab.
    expect(t2.ui.panels).toEqual([]);
    expect(t2.ui.diffPanelOpen).toBe(true);
  });

  test('skips runner instances', () => {
    register(PROJECT, makeFakeTerm({ ptyId: 'main', label: 'Shell' }));
    register(PROJECT, makeFakeTerm({ ptyId: 'runner', label: 'npm run dev', isRunner: true }));

    const snap = gatherSnapshot();
    expect(snap.terminals.map((t) => t.ptyId)).toEqual(['main']);
  });

  test('excludes auto-detected preview URLs from the snapshot', () => {
    register(PROJECT, makeFakeTerm({ ptyId: 'a', label: 'Shell', autoPreviewUrl: 'http://localhost:3000' }));

    const snap = gatherSnapshot();
    expect(snap.terminals[0].ui.panels).toEqual([]);
  });
});

describe('renameTerminal', () => {
  test('writes through to display state, the terminal instance, and the PTY record', () => {
    const term = makeFakeTerm({ ptyId: 'x', label: 'old-branch-name' });
    register(PROJECT, term);

    renameTerminal('x', '  Auth refactor  ');

    expect(term.label).toBe('Auth refactor');
    expect(useTerminalStore.getState().displayStates['x'].label).toBe('Auth refactor');
    expect(window.api.pty.setLabel).toHaveBeenCalledWith('x', 'Auth refactor');

    // …and the rename survives a snapshot.
    expect(gatherSnapshot().terminals[0]).toMatchObject({ ptyId: 'x', label: 'Auth refactor' });
  });

  test('ignores an empty/whitespace name', () => {
    const term = makeFakeTerm({ ptyId: 'x', label: 'keep-me' });
    register(PROJECT, term);

    renameTerminal('x', '   ');

    expect(term.label).toBe('keep-me');
    expect(useTerminalStore.getState().displayStates['x'].label).toBe('keep-me');
    expect(window.api.pty.setLabel).not.toHaveBeenCalled();
  });
});
