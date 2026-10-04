import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { installHookStatusListener } from '../../services/hookStatusListener';
import { terminalInstances, restoreTerminalOnce } from '../../components/terminal/terminalRegistry';
import type { OuijitTerminal } from '../../components/terminal/terminalReact';
import { TERMINAL_READY_WAIT_MS } from '../../types';

type FakeTerminal = { handleHookStatus: ReturnType<typeof vi.fn> };

function register(ptyId: string): FakeTerminal {
  const fake: FakeTerminal = { handleHookStatus: vi.fn() };
  terminalInstances.set(ptyId, fake as unknown as OuijitTerminal);
  return fake;
}

let push: (ptyId: string, status: string) => void;

describe('hook status listener', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    terminalInstances.clear();
    vi.mocked(window.api.agentHooks.onStatus)
      .mockReset()
      .mockImplementation((cb) => {
        push = cb;
        return () => {};
      });
    installHookStatusListener();
  });

  afterEach(() => vi.useRealTimers());

  it('dispatches each status to the one terminal it names', async () => {
    const term = register('pty-1');
    const other = register('pty-2');

    push('pty-1', 'thinking');
    await vi.advanceTimersByTimeAsync(0);
    expect(term.handleHookStatus).toHaveBeenCalledWith('thinking');

    push('pty-1', 'ready');
    await vi.advanceTimersByTimeAsync(0);
    expect(term.handleHookStatus).toHaveBeenLastCalledWith('ready');
    expect(other.handleHookStatus).not.toHaveBeenCalled();
  });

  it('applies statuses in the order they were pushed, even mid-reconnect', async () => {
    const seen: string[] = [];
    const term = { handleHookStatus: (s: string) => seen.push(s) };
    let finishRestore!: () => void;
    const restored = new Promise<void>((resolve) => {
      finishRestore = resolve;
    });
    void restoreTerminalOnce('pty-reloading', async () => {
      terminalInstances.set('pty-reloading', term as unknown as OuijitTerminal);
      await restored;
    });

    // `handleHookStatus` counts thinking events, so a status that overtakes an
    // earlier one leaves the dot on the wrong state.
    push('pty-reloading', 'thinking');
    await vi.advanceTimersByTimeAsync(120);
    finishRestore();
    await vi.advanceTimersByTimeAsync(0);
    push('pty-reloading', 'ready');
    await vi.advanceTimersByTimeAsync(TERMINAL_READY_WAIT_MS);

    expect(seen).toEqual(['thinking', 'ready']);
  });
});
