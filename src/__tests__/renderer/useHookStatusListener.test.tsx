/**
 * Regression coverage for T-378: the home view was missing the
 * agentHooks.onStatus subscription, so its status dot never updated after
 * the initial seed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// The hook imports terminalInstances from terminalReact, which transitively
// pulls in xterm and other browser-only modules. Stub the module surface we
// actually use so the test stays focused on the hook's logic.
vi.mock('../../components/terminal/terminalReact', () => ({
  terminalInstances: new Map<string, { handleHookStatus: ReturnType<typeof vi.fn> }>(),
}));

import { useHookStatusListener } from '../../hooks/useHookStatusListener';
import { useTerminalStore } from '../../stores/terminalStore';
import { terminalInstances } from '../../components/terminal/terminalReact';

type FakeTerminal = { handleHookStatus: ReturnType<typeof vi.fn> };

function makeFakeTerminal(): FakeTerminal {
  return { handleHookStatus: vi.fn() };
}

/** Insert fake terminals into the registry + store and return them. */
function seedTerminals(map: Record<string, string[]>): Record<string, FakeTerminal> {
  const fakes: Record<string, FakeTerminal> = {};
  for (const ptyIds of Object.values(map)) {
    for (const ptyId of ptyIds) {
      const fake = makeFakeTerminal();
      fakes[ptyId] = fake;
      (terminalInstances as Map<string, FakeTerminal>).set(ptyId, fake);
    }
  }
  useTerminalStore.setState({ terminalsByProject: map });
  return fakes;
}

describe('useHookStatusListener', () => {
  beforeEach(() => {
    (terminalInstances as Map<string, FakeTerminal>).clear();
    useTerminalStore.setState({ terminalsByProject: {} });
    vi.mocked(window.api.agentHooks.onStatus)
      .mockReset()
      .mockReturnValue(() => {});
    vi.mocked(window.api.agentHooks.getStatus).mockReset().mockResolvedValue(null);
  });

  it('subscribes to agentHooks.onStatus and dispatches events to the matching terminal', () => {
    const fakes = seedTerminals({ '/proj/a': ['pty-1'] });

    let captured: ((ptyId: string, status: string) => void) | null = null;
    vi.mocked(window.api.agentHooks.onStatus).mockImplementation((cb) => {
      captured = cb;
      return () => {};
    });

    renderHook(() => useHookStatusListener('/proj/a'));

    expect(captured).not.toBeNull();
    captured!('pty-1', 'thinking');
    expect(fakes['pty-1'].handleHookStatus).toHaveBeenCalledWith('thinking');
  });

  it('ignores events for ptyIds without a matching terminal instance', () => {
    seedTerminals({ '/proj/a': ['pty-1'] });

    let captured: ((ptyId: string, status: string) => void) | null = null;
    vi.mocked(window.api.agentHooks.onStatus).mockImplementation((cb) => {
      captured = cb;
      return () => {};
    });

    renderHook(() => useHookStatusListener('/proj/a'));

    // Should not throw; the optional chain in the hook silently no-ops.
    expect(() => captured!('pty-unknown', 'thinking')).not.toThrow();
  });

  it("with projectPath set, seeds only that project's terminals", async () => {
    const fakes = seedTerminals({
      '/proj/a': ['pty-a1', 'pty-a2'],
      '/proj/b': ['pty-b1'],
    });
    vi.mocked(window.api.agentHooks.getStatus).mockResolvedValue({
      status: 'thinking',
      thinkingCount: 1,
      readyCount: 0,
      lastUpdate: Date.now(),
    });

    renderHook(() => useHookStatusListener('/proj/a'));
    // Flush the two getStatus promises for project A.
    await Promise.resolve();
    await Promise.resolve();

    expect(window.api.agentHooks.getStatus).toHaveBeenCalledWith('pty-a1');
    expect(window.api.agentHooks.getStatus).toHaveBeenCalledWith('pty-a2');
    expect(window.api.agentHooks.getStatus).not.toHaveBeenCalledWith('pty-b1');

    expect(fakes['pty-a1'].handleHookStatus).toHaveBeenCalledWith('thinking');
    expect(fakes['pty-a2'].handleHookStatus).toHaveBeenCalledWith('thinking');
    expect(fakes['pty-b1'].handleHookStatus).not.toHaveBeenCalled();
  });

  it('with projectPath null, seeds terminals across every project (home view)', async () => {
    const fakes = seedTerminals({
      '/proj/a': ['pty-a1'],
      '/proj/b': ['pty-b1', 'pty-b2'],
    });
    vi.mocked(window.api.agentHooks.getStatus).mockResolvedValue({
      status: 'thinking',
      thinkingCount: 2,
      readyCount: 0,
      lastUpdate: Date.now(),
    });

    renderHook(() => useHookStatusListener(null));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(window.api.agentHooks.getStatus).toHaveBeenCalledWith('pty-a1');
    expect(window.api.agentHooks.getStatus).toHaveBeenCalledWith('pty-b1');
    expect(window.api.agentHooks.getStatus).toHaveBeenCalledWith('pty-b2');

    expect(fakes['pty-a1'].handleHookStatus).toHaveBeenCalledWith('thinking');
    expect(fakes['pty-b1'].handleHookStatus).toHaveBeenCalledWith('thinking');
    expect(fakes['pty-b2'].handleHookStatus).toHaveBeenCalledWith('thinking');
  });

  it('does not seed terminals whose status is ready or has thinkingCount of 0', async () => {
    const fakes = seedTerminals({ '/proj/a': ['pty-1'] });
    vi.mocked(window.api.agentHooks.getStatus).mockResolvedValue({
      status: 'ready',
      thinkingCount: 0,
      readyCount: 5,
      lastUpdate: Date.now(),
    });

    renderHook(() => useHookStatusListener('/proj/a'));
    await Promise.resolve();
    await Promise.resolve();

    expect(fakes['pty-1'].handleHookStatus).not.toHaveBeenCalled();
  });

  it('calls the cleanup returned by onStatus on unmount', () => {
    seedTerminals({ '/proj/a': ['pty-1'] });
    const cleanup = vi.fn();
    vi.mocked(window.api.agentHooks.onStatus).mockReturnValue(cleanup);

    const { unmount } = renderHook(() => useHookStatusListener('/proj/a'));
    expect(cleanup).not.toHaveBeenCalled();
    unmount();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
