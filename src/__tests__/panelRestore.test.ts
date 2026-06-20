import { describe, test, expect, vi } from 'vitest';

vi.mock('electron-log/renderer', () => ({
  default: { scope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('../components/terminal/terminalReact', () => ({
  OuijitTerminal: class {},
  terminalInstances: new Map(),
}));

import { applyInitialUiState } from '../components/terminal/terminalActions';
import type { OuijitTerminal } from '../components/terminal/terminalReact';
import type { TerminalPanel } from '../components/terminal/panelTypes';
import type { SnapshotTerminalUi } from '../types';

function makeFakeTerm() {
  const term = {
    defaultDiffMode: 'uncommitted' as const,
    panelFullWidth: true,
    panels: [] as TerminalPanel[],
    activePanelId: null as string | null,
    syncPanels: vi.fn(),
  };
  return term as unknown as OuijitTerminal & typeof term;
}

describe('applyInitialUiState', () => {
  test('restores the new multi-panel shape and the active index', async () => {
    const term = makeFakeTerm();
    const ui: SnapshotTerminalUi = {
      panels: [
        { kind: 'runner', scriptName: 'dev', scriptCommand: 'npm run dev' },
        { kind: 'plan', planPath: '/plan.md' },
      ],
      activePanelIndex: 1,
      panelFullWidth: false,
    };

    await applyInitialUiState(term, ui);

    expect(term.panels.map((p) => p.kind)).toEqual(['runner', 'plan']);
    // Runners are restored idle (never auto-respawned).
    expect(term.panels[0]).toMatchObject({ kind: 'runner', status: 'idle', scriptCommand: 'npm run dev' });
    expect(term.activePanelId).toBe(term.panels[1].id);
    expect(term.panelFullWidth).toBe(false);
    expect(term.syncPanels).toHaveBeenCalled();
  });

  test('maps a legacy singleton snapshot to panels without throwing', async () => {
    const term = makeFakeTerm();
    const ui: SnapshotTerminalUi = {
      planPath: '/plan.md',
      planPanelOpen: true,
      runner: { scriptName: 'dev', scriptCommand: 'npm run dev', panelOpen: false, fullWidth: true },
    };

    await applyInitialUiState(term, ui);

    const kinds = term.panels.map((p) => p.kind);
    expect(kinds).toContain('plan');
    expect(kinds).toContain('runner');
    // The open plan panel becomes the active one.
    const planPanel = term.panels.find((p) => p.kind === 'plan');
    expect(term.activePanelId).toBe(planPanel?.id);
  });

  test('drops a legacy auto-detected preview with no url cleanly', async () => {
    const term = makeFakeTerm();
    await applyInitialUiState(term, { webPreview: null });
    expect(term.panels).toEqual([]);
    expect(term.activePanelId).toBeNull();
  });
});
