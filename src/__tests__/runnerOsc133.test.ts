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

function makeFakeParent(): OuijitTerminal {
  return {
    runnerStatus: 'running' as const,
    pushDisplayState: vi.fn(),
  } as unknown as OuijitTerminal;
}

describe('updateRunnerStatusFromOsc133', () => {
  test('flips runnerStatus to success on OSC 133;D;0', () => {
    const parent = makeFakeParent();
    updateRunnerStatusFromOsc133('output\x1b]133;D;0\x07', parent);
    expect(parent.runnerStatus).toBe('success');
    expect(parent.pushDisplayState).toHaveBeenCalledWith({ runnerStatus: 'success' });
  });

  test('flips runnerStatus to error on non-zero OSC 133;D', () => {
    const parent = makeFakeParent();
    updateRunnerStatusFromOsc133('build failed\x1b]133;D;2\x07', parent);
    expect(parent.runnerStatus).toBe('error');
    expect(parent.pushDisplayState).toHaveBeenCalledWith({ runnerStatus: 'error' });
  });

  test('does nothing when no OSC 133 is present', () => {
    const parent = makeFakeParent();
    updateRunnerStatusFromOsc133('plain output\x1b]0;title\x07', parent);
    expect(parent.runnerStatus).toBe('running');
    expect(parent.pushDisplayState).not.toHaveBeenCalled();
  });

  test('accepts the ST terminator (ESC \\) in addition to BEL', () => {
    const parent = makeFakeParent();
    updateRunnerStatusFromOsc133('out\x1b]133;D;1\x1b\\', parent);
    expect(parent.runnerStatus).toBe('error');
  });

  test('only pushes once when the status does not change', () => {
    const parent = makeFakeParent();
    parent.runnerStatus = 'success';
    updateRunnerStatusFromOsc133('\x1b]133;D;0\x07', parent);
    expect(parent.pushDisplayState).not.toHaveBeenCalled();
  });

  test('handles multiple OSC 133 sequences in one batch — last wins', () => {
    const parent = makeFakeParent();
    updateRunnerStatusFromOsc133('\x1b]133;D;0\x07more output\x1b]133;D;1\x07', parent);
    expect(parent.runnerStatus).toBe('error');
  });
});
