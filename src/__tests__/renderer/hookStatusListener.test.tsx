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

  it('dispatches status to the terminal it names, wherever that terminal is shown', async () => {
    const term = register('pty-1');
    register('pty-2');

    push('pty-1', 'thinking');
    await vi.advanceTimersByTimeAsync(0);
    expect(term.handleHookStatus).toHaveBeenCalledWith('thinking');

    push('pty-1', 'ready');
    await vi.advanceTimersByTimeAsync(0);
    expect(term.handleHookStatus).toHaveBeenLastCalledWith('ready');
  });

  it('holds a status arriving while its terminal is still reconnecting', async () => {
    let finishRestore!: () => void;
    const restored = new Promise<void>((resolve) => {
      finishRestore = resolve;
    });
    let term!: FakeTerminal;
    void restoreTerminalOnce('pty-reloading', async () => {
      term = register('pty-reloading');
      await restored;
    });

    push('pty-reloading', 'thinking');
    await vi.advanceTimersByTimeAsync(1000);
    expect(term.handleHookStatus).not.toHaveBeenCalled();

    finishRestore();
    await vi.advanceTimersByTimeAsync(TERMINAL_READY_WAIT_MS);
    expect(term.handleHookStatus).toHaveBeenCalledWith('thinking');
  });

  it('drops a status for a session no terminal ever claims', async () => {
    expect(() => push('pty-gone', 'thinking')).not.toThrow();
    await vi.advanceTimersByTimeAsync(TERMINAL_READY_WAIT_MS);
  });
});
