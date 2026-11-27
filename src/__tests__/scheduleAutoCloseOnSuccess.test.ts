import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

import { scheduleAutoCloseOnSuccess, AUTO_CLOSE_GRACE_MS } from '../components/terminal/terminalReact';

describe('scheduleAutoCloseOnSuccess', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('closes the terminal after the grace period', () => {
    const close = vi.fn();
    scheduleAutoCloseOnSuccess(close, () => false);

    vi.advanceTimersByTime(AUTO_CLOSE_GRACE_MS - 1);
    expect(close).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(close).toHaveBeenCalledOnce();
  });

  test('skips the close when the terminal has already been disposed', () => {
    const close = vi.fn();
    let disposed = false;
    scheduleAutoCloseOnSuccess(close, () => disposed);

    disposed = true;
    vi.advanceTimersByTime(AUTO_CLOSE_GRACE_MS);

    expect(close).not.toHaveBeenCalled();
  });

  test('grace period is 3 seconds', () => {
    expect(AUTO_CLOSE_GRACE_MS).toBe(3000);
  });
});
