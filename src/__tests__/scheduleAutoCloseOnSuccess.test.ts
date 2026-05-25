import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../components/terminal/terminalActions', () => ({
  closeProjectTerminal: vi.fn(),
}));

import { scheduleAutoCloseOnSuccess, AUTO_CLOSE_GRACE_MS } from '../components/terminal/terminalReact';
import { closeProjectTerminal } from '../components/terminal/terminalActions';
import type { PtyId } from '../types';

describe('scheduleAutoCloseOnSuccess', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('closes the terminal after the grace period', () => {
    scheduleAutoCloseOnSuccess('pty-1' as PtyId, () => false);

    vi.advanceTimersByTime(AUTO_CLOSE_GRACE_MS - 1);
    expect(closeProjectTerminal).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(closeProjectTerminal).toHaveBeenCalledWith('pty-1');
  });

  test('skips the close when the terminal has already been disposed', () => {
    let disposed = false;
    scheduleAutoCloseOnSuccess('pty-2' as PtyId, () => disposed);

    disposed = true;
    vi.advanceTimersByTime(AUTO_CLOSE_GRACE_MS);

    expect(closeProjectTerminal).not.toHaveBeenCalled();
  });

  test('grace period is 3 seconds', () => {
    expect(AUTO_CLOSE_GRACE_MS).toBe(3000);
  });
});
