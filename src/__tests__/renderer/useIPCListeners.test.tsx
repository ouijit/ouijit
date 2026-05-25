/**
 * Coverage for the plumbing between a `cli:task-started` IPC push and the
 * `beginTransition` call that spawns the terminal: hookMode / hookCommand
 * from the CLI flags must thread through `PendingCliStart` and into
 * `beginTransition`'s `hookControl` option, both on the active-project
 * path and on the queued-then-drained path.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('electron-log/renderer', () => ({
  default: { scope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// The service is exercised in taskStartService.test.tsx; here we only care
// that the hook hands it the right options.
vi.mock('../../services/taskStartService', () => ({
  beginTransition: vi.fn(),
}));

import { useIPCListeners } from '../../hooks/useIPCListeners';
import { useAppStore } from '../../stores/appStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { beginTransition } from '../../services/taskStartService';
import type { TaskWithWorkspace } from '../../types';

type CliTaskStartedPayload = Parameters<Parameters<typeof window.api.onCliTaskStarted>[0]>[0];
type CliTaskStartedCb = (payload: CliTaskStartedPayload) => void;

const PROJECT = '/proj/a';

function makeTask(): TaskWithWorkspace {
  return {
    taskNumber: 9,
    name: 'Wire X',
    status: 'in_progress',
    order: 0,
    createdAt: '2026-05-23T00:00:00Z',
    worktreePath: '/wt/T-9',
    branch: 'wire-x-9',
  };
}

function basePayload(overrides: Partial<CliTaskStartedPayload> = {}): CliTaskStartedPayload {
  return {
    project: PROJECT,
    taskNumber: 9,
    worktreePath: '/wt/T-9',
    branch: 'wire-x-9',
    createdAt: '2026-05-23T00:00:00Z',
    sandboxed: false,
    ...overrides,
  };
}

/** Resolve after all pending microtasks (spawnTerminalForCliStart is async). */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

interface ListenerStubs {
  cliTaskStartedCb: CliTaskStartedCb | null;
}

/**
 * Patches the window.api listener surface useIPCListeners subscribes to.
 * Returns a handle that captures the cli:task-started callback so tests can
 * fire it directly. The setup file only mocks a subset of window.api, so we
 * fill the gaps here per-test rather than polluting the global mock.
 */
function installListenerStubs(): ListenerStubs {
  const stubs: ListenerStubs = { cliTaskStartedCb: null };
  const api = window.api as unknown as Record<string, unknown>;
  api['onUpdateAvailable'] = vi.fn(() => () => {});
  api['onWhatsNew'] = vi.fn(() => () => {});
  api['onCliChange'] = vi.fn(() => () => {});
  api['health'] = { onUpdate: vi.fn(() => () => {}) };
  api['onCliTaskStarted'] = vi.fn((cb: CliTaskStartedCb) => {
    stubs.cliTaskStartedCb = cb;
    return () => {};
  });
  api['onCliTaskCompleted'] = vi.fn(() => () => {});
  return stubs;
}

describe('useIPCListeners — cli:task-started → beginTransition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProjectStore.getState().resetForProject();
    useTerminalStore.setState({ terminalsByProject: {}, displayStates: {}, activeIndices: {} });
    useAppStore.setState({ activeProjectPath: PROJECT });
    vi.mocked(window.api.task.getByNumber).mockResolvedValue(makeTask());
  });

  test('payload with no hookMode → beginTransition called with hookControl: undefined', async () => {
    const stubs = installListenerStubs();
    renderHook(() => useIPCListeners());
    expect(stubs.cliTaskStartedCb).not.toBeNull();

    stubs.cliTaskStartedCb!(basePayload());
    await flush();

    expect(beginTransition).toHaveBeenCalledTimes(1);
    expect(vi.mocked(beginTransition).mock.calls[0][1].hookControl).toBeUndefined();
  });

  test('hookMode "skip" threads through into hookControl', async () => {
    const stubs = installListenerStubs();
    renderHook(() => useIPCListeners());

    stubs.cliTaskStartedCb!(basePayload({ hookMode: 'skip' }));
    await flush();

    expect(beginTransition).toHaveBeenCalledTimes(1);
    expect(vi.mocked(beginTransition).mock.calls[0][1].hookControl).toEqual({ mode: 'skip', command: undefined });
  });

  test('hookMode "run" threads through into hookControl', async () => {
    const stubs = installListenerStubs();
    renderHook(() => useIPCListeners());

    stubs.cliTaskStartedCb!(basePayload({ hookMode: 'run' }));
    await flush();

    expect(vi.mocked(beginTransition).mock.calls[0][1].hookControl).toEqual({ mode: 'run', command: undefined });
  });

  test('hookMode "command" threads command through into hookControl', async () => {
    const stubs = installListenerStubs();
    renderHook(() => useIPCListeners());

    stubs.cliTaskStartedCb!(basePayload({ hookMode: 'command', hookCommand: 'claude --resume' }));
    await flush();

    expect(vi.mocked(beginTransition).mock.calls[0][1].hookControl).toEqual({
      mode: 'command',
      command: 'claude --resume',
    });
  });

  test('queued-then-drained start preserves hookMode + hookCommand', async () => {
    // User is viewing a different project; the start should queue.
    useAppStore.setState({ activeProjectPath: '/proj/other' });
    const stubs = installListenerStubs();
    renderHook(() => useIPCListeners());

    stubs.cliTaskStartedCb!(basePayload({ hookMode: 'command', hookCommand: 'echo queued' }));
    await flush();

    // Should NOT have called beginTransition yet — payload is queued.
    expect(beginTransition).not.toHaveBeenCalled();
    expect(useProjectStore.getState().pendingCliStarts[PROJECT]?.[0]?.hookMode).toBe('command');

    // Activate the project; the queued start drains and beginTransition fires.
    useAppStore.setState({ activeProjectPath: PROJECT });
    await flush();

    expect(beginTransition).toHaveBeenCalledTimes(1);
    expect(vi.mocked(beginTransition).mock.calls[0][1].hookControl).toEqual({
      mode: 'command',
      command: 'echo queued',
    });
  });
});
