import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

import { useIPCListeners } from '../../hooks/useIPCListeners';
import { useAppStore } from '../../stores/appStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { beginTransition } from '../../services/taskStartService';
import { completeTask } from '../../services/taskCompletion';
import type { TaskWithWorkspace } from '../../types';
import { seedProject } from './seedProject';
import { usePointerStore } from '../../stores/pointerStore';
import { followPointer } from '../../components/point/followPointer';

vi.mock('electron-log/renderer', () => ({
  default: { scope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// The services are exercised in their own suites; here we only care that the
// hook hands them the right options.
vi.mock('../../services/taskStartService', () => ({
  beginTransition: vi.fn(),
}));
vi.mock('../../services/taskCompletion', () => ({
  completeTask: vi.fn().mockResolvedValue(undefined),
}));

type CliTaskStartedPayload = Parameters<Parameters<typeof window.api.onCliTaskStarted>[0]>[0];
type CliTaskStartedCb = (payload: CliTaskStartedPayload) => void;
type CliTaskTransitionedPayload = Parameters<Parameters<typeof window.api.onCliTaskTransitioned>[0]>[0];
type CliTaskTransitionedCb = (payload: CliTaskTransitionedPayload) => void;
type CliTaskCompletedPayload = Parameters<Parameters<typeof window.api.onCliTaskCompleted>[0]>[0];
type CliTaskCompletedCb = (payload: CliTaskCompletedPayload) => void;

const PROJECT = '/proj/a';
const OTHER = '/proj/b';

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

function transitionPayload(overrides: Partial<CliTaskTransitionedPayload> = {}): CliTaskTransitionedPayload {
  return {
    project: PROJECT,
    taskNumber: 9,
    origStatus: 'in_progress',
    newStatus: 'in_review',
    task: makeTask(),
    ...overrides,
  };
}

function completedPayload(overrides: Partial<CliTaskCompletedPayload> = {}): CliTaskCompletedPayload {
  return {
    project: PROJECT,
    taskNumber: 9,
    task: makeTask(),
    ...overrides,
  };
}

type CliChangePayload = Parameters<Parameters<typeof window.api.onCliChange>[0]>[0];
type LaunchFailedCb = Parameters<typeof window.api.onSandboxLaunchFailed>[0];
type TerminalSandboxCb = Parameters<typeof window.api.onTerminalSandbox>[0];
type CliChangeCb = (payload: CliChangePayload) => void;

interface ListenerStubs {
  cliTaskStartedCb: CliTaskStartedCb | null;
  cliTaskTransitionedCb: CliTaskTransitionedCb | null;
  cliTaskCompletedCb: CliTaskCompletedCb | null;
  cliChangeCb: CliChangeCb | null;
  launchFailedCb: LaunchFailedCb | null;
  terminalSandboxCb: TerminalSandboxCb | null;
}

/**
 * Patches the window.api listener surface useIPCListeners subscribes to.
 * Returns a handle that captures the cli:task-started callback so tests can
 * fire it directly. The setup file only mocks a subset of window.api, so we
 * fill the gaps here per-test rather than polluting the global mock.
 */
function installListenerStubs(): ListenerStubs {
  const stubs: ListenerStubs = {
    cliTaskStartedCb: null,
    cliTaskTransitionedCb: null,
    cliTaskCompletedCb: null,
    cliChangeCb: null,
    launchFailedCb: null,
    terminalSandboxCb: null,
  };
  const api = window.api as unknown as Record<string, unknown>;
  api['onUpdateAvailable'] = vi.fn(() => () => {});
  api['onShellUnsupported'] = vi.fn(() => () => {});
  api['onSandboxLaunchFailed'] = vi.fn((cb: LaunchFailedCb) => {
    stubs.launchFailedCb = cb;
    return () => {};
  });
  api['onTerminalSandbox'] = vi.fn((cb: TerminalSandboxCb) => {
    stubs.terminalSandboxCb = cb;
    return () => {};
  });
  api['onWhatsNew'] = vi.fn(() => () => {});
  api['onShowAbout'] = vi.fn(() => () => {});
  api['onCliChange'] = vi.fn((cb: CliChangeCb) => {
    stubs.cliChangeCb = cb;
    return () => {};
  });
  api['onCliThemeChanged'] = vi.fn(() => () => {});
  api['health'] = { onUpdate: vi.fn(() => () => {}) };
  api['onCliTaskStarted'] = vi.fn((cb: CliTaskStartedCb) => {
    stubs.cliTaskStartedCb = cb;
    return () => {};
  });
  api['onCliTaskCompleted'] = vi.fn((cb: CliTaskCompletedCb) => {
    stubs.cliTaskCompletedCb = cb;
    return () => {};
  });
  api['onCliTaskTransitioned'] = vi.fn((cb: CliTaskTransitionedCb) => {
    stubs.cliTaskTransitionedCb = cb;
    return () => {};
  });
  return stubs;
}

describe('useIPCListeners — CLI task lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTerminalStore.setState({ terminalsByProject: {}, displayStates: {}, order: [] });
    vi.mocked(window.api.task.getByNumber).mockResolvedValue(makeTask());
  });

  test.each([
    ['its own project', PROJECT],
    ['home', null],
    ['another project', OTHER],
  ])(
    "runs a start, transition or completion at once while %s is showing, with the CLI's hook flags, behind what's on screen",
    async (_, active) => {
      useAppStore.setState({ activeProjectPath: active });
      const stubs = installListenerStubs();
      renderHook(() => useIPCListeners());

      stubs.cliTaskStartedCb!(basePayload({ hookMode: 'skip' }));
      stubs.cliTaskStartedCb!(basePayload({ hookMode: 'run' }));
      stubs.cliTaskStartedCb!(basePayload({ hookMode: 'command', hookCommand: 'claude --resume' }));
      // No flags and no hook configured: nothing to ask, so it runs too.
      stubs.cliTaskStartedCb!(basePayload());
      await flush();
      expect(
        vi
          .mocked(beginTransition)
          .mock.calls.map(([path, opts]) => [path, opts.newStatus, opts.hookControl, opts.background]),
      ).toEqual([
        [PROJECT, 'in_progress', { mode: 'skip', command: undefined }, true],
        [PROJECT, 'in_progress', { mode: 'run', command: undefined }, true],
        [PROJECT, 'in_progress', { mode: 'command', command: 'claude --resume' }, true],
        [PROJECT, 'in_progress', undefined, true],
      ]);

      vi.mocked(beginTransition).mockClear();
      stubs.cliTaskTransitionedCb!(transitionPayload());
      stubs.cliTaskTransitionedCb!(transitionPayload({ hookMode: 'command', hookCommand: 'claude review' }));
      await flush();
      expect(
        vi
          .mocked(beginTransition)
          .mock.calls.map(([, opts]) => [opts.origStatus, opts.newStatus, opts.hookControl, opts.background]),
      ).toEqual([
        ['in_progress', 'in_review', undefined, true],
        ['in_progress', 'in_review', { mode: 'command', command: 'claude review' }, true],
      ]);

      stubs.cliTaskCompletedCb!(completedPayload());
      stubs.cliTaskCompletedCb!(completedPayload({ hookMode: 'command', hookCommand: 'npm run deploy' }));
      await flush();
      expect(
        vi.mocked(completeTask).mock.calls.map(([opts]) => [opts.projectPath, opts.hookControl, opts.skipStatusWrite]),
      ).toEqual([
        [PROJECT, undefined, true],
        [PROJECT, { mode: 'command', command: 'npm run deploy' }, true],
      ]);
    },
  );

  test("a move whose hook would ask waits behind a pointer from the terminal that ran it, and asks once it's followed", async () => {
    usePointerStore.setState({ pointers: [] });
    vi.mocked(window.api.hooks.get).mockResolvedValue({
      start: { id: 's', type: 'start', name: 'Agent', command: 'claude' },
      review: { id: 'r', type: 'review', name: 'PR', command: 'gh pr create' },
      done: { id: 'd', type: 'done', name: 'Push', command: 'git push' },
    });
    const stubs = installListenerStubs();
    renderHook(() => useIPCListeners());

    stubs.cliTaskStartedCb!(basePayload({ fromPtyId: 'pty-agent' }));
    await flush();
    expect(beginTransition).not.toHaveBeenCalled();
    const [pointer] = usePointerStore.getState().pointers;
    expect(pointer).toEqual(
      expect.objectContaining({ from: 'pty-agent', target: { kind: 'task', projectPath: PROJECT, taskNumber: 9 } }),
    );

    await followPointer(pointer);
    expect(
      vi.mocked(beginTransition).mock.calls.map(([, opts]) => [opts.newStatus, opts.hookControl, opts.background]),
    ).toEqual([['in_progress', undefined, false]]);
    expect(usePointerStore.getState().pointers).toEqual([]);

    // Review and done wait the same way; with flags they run at once, and --point leaves a pointer anyway.
    stubs.cliTaskTransitionedCb!(transitionPayload({ fromPtyId: 'pty-agent' }));
    stubs.cliTaskCompletedCb!(completedPayload({ fromPtyId: 'pty-other' }));
    await flush();
    expect(usePointerStore.getState().pointers.map((p) => p.from)).toEqual(['pty-agent', 'pty-other']);
    expect(completeTask).not.toHaveBeenCalled();

    vi.mocked(beginTransition).mockClear();
    stubs.cliTaskStartedCb!(basePayload({ fromPtyId: 'pty-third', hookMode: 'run', point: true }));
    await flush();
    expect(beginTransition).toHaveBeenCalledTimes(1);
    expect(usePointerStore.getState().pointers.find((p) => p.from === 'pty-third')?.waiting).toBeUndefined();
  });

  test('moves from one terminal stack on its pointer, survive it pointing elsewhere, and all run on follow', async () => {
    usePointerStore.setState({ pointers: [] });
    vi.mocked(window.api.hooks.get).mockResolvedValue({
      start: { id: 's', type: 'start', name: 'Agent', command: 'claude' },
    });
    vi.mocked(window.api.task.getByNumber).mockImplementation(async (_p, n) => ({ ...makeTask(), taskNumber: n }));
    const stubs = installListenerStubs();
    renderHook(() => useIPCListeners());

    // A loop of starts without --run-hook, as an agent would write it.
    for (const taskNumber of [12, 13, 14]) {
      stubs.cliTaskStartedCb!(basePayload({ fromPtyId: 'pty-agent', taskNumber }));
      await flush();
    }
    expect(beginTransition).not.toHaveBeenCalled();
    expect(usePointerStore.getState().pointers).toHaveLength(1);

    // The agent pointing somewhere else, then clearing, drops none of them.
    usePointerStore.getState().point({ from: 'pty-agent', target: { kind: 'board', projectPath: PROJECT } });
    usePointerStore.getState().clear('pty-agent');
    const [pointer] = usePointerStore.getState().pointers;
    expect(pointer.target).toEqual({ kind: 'task', projectPath: PROJECT, taskNumber: 14 });

    await followPointer(pointer);
    expect(vi.mocked(beginTransition).mock.calls.map(([, opts]) => opts.task.taskNumber)).toEqual([12, 13, 14]);
    expect(usePointerStore.getState().pointers).toEqual([]);
  });

  test("a sandboxed caller's --run-hook runs a sandboxed hook at once, and waits for the user when the hook would run on the host", async () => {
    usePointerStore.setState({ pointers: [] });
    vi.mocked(window.api.hooks.get).mockResolvedValue({
      start: { id: 's', type: 'start', name: 'Agent', command: 'claude', sandbox: 'nono' },
      review: { id: 'r', type: 'review', name: 'Tests', command: 'npm test' },
    });
    const stubs = installListenerStubs();
    renderHook(() => useIPCListeners());

    stubs.cliTaskStartedCb!(basePayload({ fromPtyId: 'pty-agent', fromSandbox: true, hookMode: 'run' }));
    stubs.cliTaskTransitionedCb!(transitionPayload({ fromPtyId: 'pty-agent', fromSandbox: true, hookMode: 'run' }));
    await flush();
    expect(vi.mocked(beginTransition).mock.calls.map(([, opts]) => [opts.newStatus, opts.hookControl])).toEqual([
      ['in_progress', { mode: 'run', command: undefined }],
    ]);
    const [pointer] = usePointerStore.getState().pointers;
    expect(pointer.target).toEqual({ kind: 'task', projectPath: PROJECT, taskNumber: 9 });

    vi.mocked(beginTransition).mockClear();
    await followPointer(pointer);
    expect(vi.mocked(beginTransition).mock.calls.map(([, opts]) => [opts.newStatus, opts.hookControl])).toEqual([
      ['in_review', undefined],
    ]);
  });
});

describe('useIPCListeners — cli-change refreshes the resource that changed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ activeProjectPath: PROJECT });
  });

  function fire(resource: string, project = PROJECT): void {
    const stubs = installListenerStubs();
    renderHook(() => useIPCListeners());
    stubs.cliChangeCb!({ project, action: `PUT /api/${resource}/x`, resource, ts: 0 });
  }

  test('routes each resource to its own loader, for whichever project it touched', async () => {
    // A project's config and scripts refresh once something has loaded them;
    // its tasks are held for every project, so those always refresh.
    seedProject(PROJECT, { hooks: {}, scripts: [] });
    seedProject(OTHER, { hooks: {}, scripts: [] });

    fire('scripts');
    await flush();
    expect(window.api.scripts.getAll).toHaveBeenCalledWith(PROJECT);
    expect(window.api.task.getAll).not.toHaveBeenCalled();

    vi.clearAllMocks();
    fire('hooks', OTHER);
    await flush();
    expect(window.api.hooks.get).toHaveBeenCalledWith(OTHER);
    expect(window.api.task.getAll).not.toHaveBeenCalled();

    // `ouijit sandbox-command set` changes which backends are ready to spawn.
    vi.clearAllMocks();
    fire('sandbox');
    await flush();
    expect(window.api.sandbox.status).toHaveBeenCalledWith(PROJECT);

    vi.clearAllMocks();
    fire('tasks', '/proj/never-loaded');
    await flush();
    expect(window.api.task.getAll).toHaveBeenCalledWith('/proj/never-loaded');
    expect(window.api.scripts.getAll).not.toHaveBeenCalled();

    vi.clearAllMocks();
    fire('scripts', '/proj/never-loaded');
    await flush();
    expect(window.api.scripts.getAll).not.toHaveBeenCalled();
  });
});

describe('useIPCListeners — sandbox-launch-failed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('a launcher or spawn refusal becomes a persistent error toast naming the backend and why', () => {
    const stubs = installListenerStubs();
    renderHook(() => useIPCListeners());
    stubs.launchFailedCb!({ ptyId: 'pty-1', provider: 'custom', exitCode: 2 });
    stubs.launchFailedCb!({ ptyId: 'pty-2', provider: 'nono', error: 'nono is not installed.' });
    const toasts = useProjectStore.getState().toasts.filter((t) => t.message.includes('failed to start'));
    expect(toasts.map((t) => [t.message, t.type, t.persistent])).toEqual([
      ['Custom failed to start (exit 2). See the terminal output.', 'error', true],
      ['Sandbox failed to start: nono is not installed.', 'error', true],
    ]);
  });

  test('a terminal shows the sandbox its foreground command runs in, and drops it after', () => {
    const stubs = installListenerStubs();
    renderHook(() => useIPCListeners());
    useTerminalStore.getState().addTerminal('/p', 'pty-9', { taskId: null, label: 'shell' });
    stubs.terminalSandboxCb!({ ptyId: 'pty-9', sandboxProvider: 'nono' });
    expect(useTerminalStore.getState().displayStates['pty-9']?.sandboxProvider).toBe('nono');
    stubs.terminalSandboxCb!({ ptyId: 'pty-9' });
    expect(useTerminalStore.getState().displayStates['pty-9']?.sandboxProvider).toBeUndefined();
  });
});
