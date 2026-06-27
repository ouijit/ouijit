import { describe, test, expect, vi } from 'vitest';

vi.mock('electron-log/renderer', () => ({
  default: { scope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('../components/terminal/terminalReact', () => ({
  OuijitTerminal: class {},
  terminalInstances: new Map(),
}));

import { updateRunnerStatusFromOsc133 } from '../components/terminal/terminalActions';
import type { OuijitTerminal } from '../components/terminal/terminalReact';
import type { RunnerStatus } from '../components/terminal/panelTypes';

const PANEL_ID = 'panel-1';

function makeFakeParent(initial: RunnerStatus = 'running') {
  const runnerPanel = {
    id: PANEL_ID,
    kind: 'runner' as const,
    scriptName: null,
    scriptCommand: null,
    command: null,
    status: initial,
  };
  const updatePanel = vi.fn((id: string, patch: Record<string, unknown>) => {
    if (id === runnerPanel.id) Object.assign(runnerPanel, patch);
  });
  const parent = { panels: [runnerPanel], updatePanel } as unknown as OuijitTerminal;
  return { parent, runnerPanel, updatePanel };
}

describe('updateRunnerStatusFromOsc133', () => {
  test('flips the runner panel status to success on OSC 133;D;0', () => {
    const { parent, runnerPanel, updatePanel } = makeFakeParent();
    updateRunnerStatusFromOsc133('output\x1b]133;D;0\x07', parent, PANEL_ID);
    expect(runnerPanel.status).toBe('success');
    expect(updatePanel).toHaveBeenCalledWith(PANEL_ID, { status: 'success' });
  });

  test('flips the runner panel status to error on non-zero OSC 133;D', () => {
    const { parent, runnerPanel, updatePanel } = makeFakeParent();
    updateRunnerStatusFromOsc133('build failed\x1b]133;D;2\x07', parent, PANEL_ID);
    expect(runnerPanel.status).toBe('error');
    expect(updatePanel).toHaveBeenCalledWith(PANEL_ID, { status: 'error' });
  });

  test('does nothing when no OSC 133 is present', () => {
    const { parent, runnerPanel, updatePanel } = makeFakeParent();
    updateRunnerStatusFromOsc133('plain output\x1b]0;title\x07', parent, PANEL_ID);
    expect(runnerPanel.status).toBe('running');
    expect(updatePanel).not.toHaveBeenCalled();
  });

  test('accepts the ST terminator (ESC \\) in addition to BEL', () => {
    const { parent, runnerPanel } = makeFakeParent();
    updateRunnerStatusFromOsc133('out\x1b]133;D;1\x1b\\', parent, PANEL_ID);
    expect(runnerPanel.status).toBe('error');
  });

  test('only pushes once when the status does not change', () => {
    const { parent, updatePanel } = makeFakeParent('success');
    updateRunnerStatusFromOsc133('\x1b]133;D;0\x07', parent, PANEL_ID);
    expect(updatePanel).not.toHaveBeenCalled();
  });

  test('handles multiple OSC 133 sequences in one batch — last wins', () => {
    const { parent, runnerPanel } = makeFakeParent();
    updateRunnerStatusFromOsc133('\x1b]133;D;0\x07more output\x1b]133;D;1\x07', parent, PANEL_ID);
    expect(runnerPanel.status).toBe('error');
  });
});
