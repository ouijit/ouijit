import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  terminalInstances,
  restoreTerminalOnce,
  whenTerminalReady,
} from '../components/terminal/terminalRegistry';
import type { OuijitTerminal } from '../components/terminal/terminalReact';

const WAIT_MS = 3000;

function fakeTerminal(): OuijitTerminal {
  return {} as OuijitTerminal;
}

describe('terminal registry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    terminalInstances.clear();
  });

  afterEach(() => vi.useRealTimers());

  it('restores a session once however many callers ask, and holds them all until it is done', async () => {
    // Two views reconnect the same session on a renderer reload: the home
    // view's unscoped sweep and the project view's scoped one.
    let finish!: () => void;
    let restores = 0;
    const restore = async (): Promise<void> => {
      restores++;
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      terminalInstances.set('pty-1', fakeTerminal());
    };

    let winnerDone = false;
    let loserDone = false;
    void restoreTerminalOnce('pty-1', restore).then(() => (winnerDone = true));
    void restoreTerminalOnce('pty-1', restore).then(() => (loserDone = true));

    await vi.advanceTimersByTimeAsync(0);
    expect(restores).toBe(1);
    expect(loserDone).toBe(false);

    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(winnerDone && loserDone).toBe(true);
    // A caller arriving after the restore does not start another.
    await restoreTerminalOnce('pty-1', restore);
    expect(restores).toBe(1);
  });

  it('waits out a restore before handing the terminal over, and gives up at the deadline', async () => {
    const term = fakeTerminal();
    void restoreTerminalOnce('pty-1', async () => {
      terminalInstances.set('pty-1', term);
      await new Promise(() => {}); // a restore that never settles
    });

    const ready = whenTerminalReady('pty-1', WAIT_MS);
    await vi.advanceTimersByTimeAsync(WAIT_MS - 1);
    // Registered but still restoring, so nothing has been handed over yet.
    expect(await Promise.race([ready, 'pending'])).toBe('pending');

    await vi.advanceTimersByTimeAsync(1);
    expect(await ready).toBe(term);

    expect(await whenTerminalReady('pty-absent', 0)).toBeNull();
  });
});
