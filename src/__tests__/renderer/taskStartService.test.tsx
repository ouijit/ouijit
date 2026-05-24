import { describe, test, expect, beforeEach, vi } from 'vitest';

// electron-log/renderer expects an Electron host to talk to via IPC. Stub it
// to a no-op logger so the service module evaluates cleanly under jsdom.
vi.mock('electron-log/renderer', () => ({
  default: { scope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// Avoid loading the real terminal actions (which transitively pulls in xterm).
vi.mock('../../components/terminal/terminalActions', () => ({
  addProjectTerminal: vi.fn().mockResolvedValue(true),
  closeProjectTerminal: vi.fn(),
}));

import { useProjectStore } from '../../stores/projectStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { beginTransition } from '../../services/taskStartService';
import { addProjectTerminal, closeProjectTerminal } from '../../components/terminal/terminalActions';
import type { TaskWithWorkspace } from '../../types';

const PROJECT = '/project';

function makeTask(): TaskWithWorkspace {
  return {
    taskNumber: 7,
    name: 'Wire up auth',
    status: 'todo',
    order: 0,
    createdAt: '2026-01-01T00:00:00Z',
  };
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await flushPromises();
  }
  throw new Error('waitFor timeout');
}

describe('taskStartService.beginTransition', () => {
  beforeEach(() => {
    useProjectStore.getState().resetForProject();
    useTerminalStore.setState({ terminalsByProject: {}, displayStates: {}, activeIndices: {} });
    vi.clearAllMocks();
    vi.mocked(window.api.hooks.get).mockResolvedValue({});
    vi.mocked(window.api.task.start).mockResolvedValue({
      success: true,
      worktreePath: '/wt/T-7',
      task: { taskNumber: 7, name: 'Wire up auth', branch: 'wire-up-auth-7', status: 'in_progress', createdAt: '' },
    });
    vi.mocked(window.api.task.getAll).mockResolvedValue([]);
  });

  test('drop into in_progress without a hook: places loading slot, replaces it on spawn', async () => {
    beginTransition(PROJECT, {
      origStatus: 'todo',
      newStatus: 'in_progress',
      task: makeTask(),
    });

    // Slot inserted synchronously with isLoading flag.
    const ids = useTerminalStore.getState().terminalsByProject[PROJECT] ?? [];
    expect(ids).toHaveLength(1);
    const slotId = ids[0];
    expect(useTerminalStore.getState().displayStates[slotId]?.isLoading).toBe(true);
    expect(useProjectStore.getState().startingTaskNumbers.has(7)).toBe(true);

    // Wait for the lifecycle to spawn a terminal and clear the flag.
    await waitFor(() => !useProjectStore.getState().startingTaskNumbers.has(7));

    // No hook → addProjectTerminal called once with replaceLoadingId for the slot.
    expect(addProjectTerminal).toHaveBeenCalledTimes(1);
    expect(vi.mocked(addProjectTerminal).mock.calls[0][2]).toMatchObject({
      replaceLoadingId: slotId,
      taskId: 7,
    });

    // Starting flag cleared.
    expect(useProjectStore.getState().startingTaskNumbers.has(7)).toBe(false);
  });

  test('hook prompt cancel: still spawns a plain shell so the loading slot resolves', async () => {
    vi.mocked(window.api.hooks.get).mockResolvedValue({
      start: { command: 'npm install', name: 'Start', source: 'configured', priority: 0 },
    });

    beginTransition(PROJECT, {
      origStatus: 'todo',
      newStatus: 'in_progress',
      task: makeTask(),
    });

    // Wait for the dialog request to appear.
    await waitFor(() => useProjectStore.getState().runHookQueue[0] != null);
    const req = useProjectStore.getState().runHookQueue[0]!;
    expect(req.hookType).toBe('start');

    // User cancels.
    useProjectStore.getState().resolveRunHookRequest(req.id, null);

    await waitFor(() => !useProjectStore.getState().startingTaskNumbers.has(7));

    // Terminal still spawned, but with no runConfig (plain shell).
    expect(addProjectTerminal).toHaveBeenCalledTimes(1);
    expect(vi.mocked(addProjectTerminal).mock.calls[0][1]).toBeUndefined();
  });

  test('hook prompt accept: spawns terminal with the captured command', async () => {
    vi.mocked(window.api.hooks.get).mockResolvedValue({
      start: { command: 'npm install', name: 'Start', source: 'configured', priority: 0 },
    });

    beginTransition(PROJECT, {
      origStatus: 'todo',
      newStatus: 'in_progress',
      task: makeTask(),
    });

    await waitFor(() => useProjectStore.getState().runHookQueue[0] != null);
    const req = useProjectStore.getState().runHookQueue[0]!;
    useProjectStore.getState().resolveRunHookRequest(req.id, { command: 'npm ci', sandboxed: false, foreground: true });

    await waitFor(() => !useProjectStore.getState().startingTaskNumbers.has(7));

    expect(addProjectTerminal).toHaveBeenCalledTimes(1);
    expect(vi.mocked(addProjectTerminal).mock.calls[0][1]).toMatchObject({ command: 'npm ci' });
  });

  test('Run & Open fires onForegroundOpen as soon as the dialog closes, not after worktree create', async () => {
    vi.mocked(window.api.hooks.get).mockResolvedValue({
      start: { command: 'npm install', name: 'Start', source: 'configured', priority: 0 },
    });

    // Hold worktree creation open so we can assert ordering.
    let releaseWorktree: (() => void) | undefined;
    vi.mocked(window.api.task.start).mockReturnValue(
      new Promise((resolve) => {
        releaseWorktree = () =>
          resolve({
            success: true,
            worktreePath: '/wt/T-7',
            task: {
              taskNumber: 7,
              name: 'Wire up auth',
              branch: 'wire-up-auth-7',
              status: 'in_progress',
              createdAt: '',
            },
          });
      }),
    );

    const onForegroundOpen = vi.fn();
    beginTransition(PROJECT, {
      origStatus: 'todo',
      newStatus: 'in_progress',
      task: makeTask(),
      onForegroundOpen,
    });

    await waitFor(() => useProjectStore.getState().runHookQueue[0] != null);
    const req = useProjectStore.getState().runHookQueue[0]!;
    useProjectStore.getState().resolveRunHookRequest(req.id, { command: 'npm ci', sandboxed: false, foreground: true });

    // Should fire before the worktree resolves.
    await waitFor(() => onForegroundOpen.mock.calls.length === 1);
    expect(addProjectTerminal).not.toHaveBeenCalled();

    releaseWorktree!();

    await waitFor(() => !useProjectStore.getState().startingTaskNumbers.has(7));

    // Still only fired once — not double-called after the spawn.
    expect(onForegroundOpen).toHaveBeenCalledTimes(1);
    expect(addProjectTerminal).toHaveBeenCalledTimes(1);
  });

  test('Run (background) does not fire onForegroundOpen', async () => {
    vi.mocked(window.api.hooks.get).mockResolvedValue({
      start: { command: 'npm install', name: 'Start', source: 'configured', priority: 0 },
    });

    const onForegroundOpen = vi.fn();
    beginTransition(PROJECT, {
      origStatus: 'todo',
      newStatus: 'in_progress',
      task: makeTask(),
      onForegroundOpen,
    });

    await waitFor(() => useProjectStore.getState().runHookQueue[0] != null);
    const req = useProjectStore.getState().runHookQueue[0]!;
    useProjectStore
      .getState()
      .resolveRunHookRequest(req.id, { command: 'npm ci', sandboxed: false, foreground: false });

    await waitFor(() => !useProjectStore.getState().startingTaskNumbers.has(7));

    expect(onForegroundOpen).not.toHaveBeenCalled();
  });

  test('done transition: closes pre-existing task terminals but keeps the done-hook terminal', async () => {
    // A terminal already open for task 7.
    useTerminalStore.getState().addTerminal(PROJECT, 'pty-old', { label: 'old', taskId: 7 });

    vi.mocked(window.api.hooks.get).mockResolvedValue({
      done: { command: 'echo hey', name: 'Done', source: 'configured', priority: 0 },
    });

    // The done-hook terminal registers itself in the store, tied to the same
    // task, so we can prove the cleanup does not close it.
    vi.mocked(addProjectTerminal).mockImplementation(async () => {
      useTerminalStore.getState().addTerminal(PROJECT, 'pty-hook', { label: 'Done', taskId: 7 });
      return true;
    });

    beginTransition(PROJECT, {
      origStatus: 'in_review',
      newStatus: 'done',
      task: { ...makeTask(), status: 'in_review', worktreePath: '/wt/T-7', branch: 'wire-up-auth-7' },
    });

    await waitFor(() => useProjectStore.getState().runHookQueue[0] != null);
    const req = useProjectStore.getState().runHookQueue[0]!;
    expect(req.hookType).toBe('done');
    useProjectStore
      .getState()
      .resolveRunHookRequest(req.id, { command: 'echo hey', sandboxed: false, foreground: false });

    await waitFor(() => vi.mocked(closeProjectTerminal).mock.calls.length > 0);
    await flushPromises();

    // Hook terminal spawned with the 'Done' label and the captured command.
    expect(vi.mocked(addProjectTerminal).mock.calls[0][1]).toMatchObject({ name: 'Done', command: 'echo hey' });

    // Only the pre-existing terminal was closed; the done-hook terminal survives.
    expect(vi.mocked(closeProjectTerminal).mock.calls.map((c) => c[0])).toEqual(['pty-old']);
  });

  test('worktree creation failure: cleans up the loading slot', async () => {
    vi.mocked(window.api.task.start).mockResolvedValue({ success: false, error: 'boom' });

    beginTransition(PROJECT, {
      origStatus: 'todo',
      newStatus: 'in_progress',
      task: makeTask(),
    });

    await waitFor(() => (useTerminalStore.getState().terminalsByProject[PROJECT] ?? []).length === 0);

    expect(useProjectStore.getState().startingTaskNumbers.has(7)).toBe(false);
    expect(addProjectTerminal).not.toHaveBeenCalled();
  });

  describe('hookControl (CLI flags) skips the dialog', () => {
    test('mode "skip": spawns a plain shell, never opens the dialog', async () => {
      vi.mocked(window.api.hooks.get).mockResolvedValue({
        start: { command: 'npm install', name: 'Start', source: 'configured', priority: 0 },
      });

      beginTransition(PROJECT, {
        origStatus: 'todo',
        newStatus: 'in_progress',
        task: makeTask(),
        hookControl: { mode: 'skip' },
      });

      await waitFor(() => !useProjectStore.getState().startingTaskNumbers.has(7));

      expect(useProjectStore.getState().runHookQueue[0]).toBeUndefined();
      expect(addProjectTerminal).toHaveBeenCalledTimes(1);
      expect(vi.mocked(addProjectTerminal).mock.calls[0][1]).toBeUndefined();
    });

    test('mode "run": runs the configured hook command without the dialog', async () => {
      vi.mocked(window.api.hooks.get).mockResolvedValue({
        start: { command: 'npm install', name: 'Start', source: 'configured', priority: 0 },
      });

      beginTransition(PROJECT, {
        origStatus: 'todo',
        newStatus: 'in_progress',
        task: makeTask(),
        hookControl: { mode: 'run' },
      });

      await waitFor(() => !useProjectStore.getState().startingTaskNumbers.has(7));

      expect(useProjectStore.getState().runHookQueue[0]).toBeUndefined();
      expect(addProjectTerminal).toHaveBeenCalledTimes(1);
      expect(vi.mocked(addProjectTerminal).mock.calls[0][1]).toMatchObject({ command: 'npm install' });
    });

    test('mode "run" with no configured hook: plain shell', async () => {
      beginTransition(PROJECT, {
        origStatus: 'todo',
        newStatus: 'in_progress',
        task: makeTask(),
        hookControl: { mode: 'run' },
      });

      await waitFor(() => !useProjectStore.getState().startingTaskNumbers.has(7));

      expect(useProjectStore.getState().runHookQueue[0]).toBeUndefined();
      expect(vi.mocked(addProjectTerminal).mock.calls[0][1]).toBeUndefined();
    });

    test('mode "command": runs the one-off command without the dialog', async () => {
      vi.mocked(window.api.hooks.get).mockResolvedValue({
        start: { command: 'npm install', name: 'Start', source: 'configured', priority: 0 },
      });

      beginTransition(PROJECT, {
        origStatus: 'todo',
        newStatus: 'in_progress',
        task: makeTask(),
        hookControl: { mode: 'command', command: 'claude --resume' },
      });

      await waitFor(() => !useProjectStore.getState().startingTaskNumbers.has(7));

      expect(useProjectStore.getState().runHookQueue[0]).toBeUndefined();
      expect(vi.mocked(addProjectTerminal).mock.calls[0][1]).toMatchObject({ command: 'claude --resume' });
    });
  });

  test('duplicate concurrent drop for the same task is deduped', async () => {
    beginTransition(PROJECT, { origStatus: 'todo', newStatus: 'in_progress', task: makeTask() });
    beginTransition(PROJECT, { origStatus: 'todo', newStatus: 'in_progress', task: makeTask() });

    // Only one slot inserted.
    const ids = useTerminalStore.getState().terminalsByProject[PROJECT] ?? [];
    expect(ids).toHaveLength(1);

    await waitFor(() => !useProjectStore.getState().startingTaskNumbers.has(7));

    // Only one start IPC and one terminal spawn.
    expect(window.api.task.start).toHaveBeenCalledTimes(1);
    expect(addProjectTerminal).toHaveBeenCalledTimes(1);
  });

  test('concurrent starts queue both hook prompts instead of dropping the first', async () => {
    vi.mocked(window.api.hooks.get).mockResolvedValue({
      start: { command: 'npm install', name: 'Start', source: 'configured', priority: 0 },
    });
    vi.mocked(window.api.task.start).mockImplementation(async (_projectPath, taskNumber) => ({
      success: true,
      worktreePath: `/wt/T-${taskNumber}`,
      task: { taskNumber, name: `Task ${taskNumber}`, branch: `t-${taskNumber}`, status: 'in_progress', createdAt: '' },
    }));

    beginTransition(PROJECT, { origStatus: 'todo', newStatus: 'in_progress', task: { ...makeTask(), taskNumber: 7 } });
    beginTransition(PROJECT, {
      origStatus: 'todo',
      newStatus: 'in_progress',
      task: { ...makeTask(), taskNumber: 8, name: 'Second task' },
    });

    // Both prompts queue up — the second does not evict the first.
    await waitFor(() => useProjectStore.getState().runHookQueue.length === 2);
    expect(useProjectStore.getState().runHookQueueTotal).toBe(2);
    expect(useProjectStore.getState().runHookQueue[0]!.task.taskNumber).toBe(7);

    // Resolve the head — the second prompt slides into its place.
    useProjectStore.getState().resolveRunHookRequest(useProjectStore.getState().runHookQueue[0]!.id, null);
    await waitFor(() => useProjectStore.getState().runHookQueue.length === 1);
    expect(useProjectStore.getState().runHookQueue[0]!.task.taskNumber).toBe(8);
    // Total stays fixed so the stepper counts up rather than shrinking.
    expect(useProjectStore.getState().runHookQueueTotal).toBe(2);

    useProjectStore.getState().resolveRunHookRequest(useProjectStore.getState().runHookQueue[0]!.id, null);
    await waitFor(
      () =>
        !useProjectStore.getState().startingTaskNumbers.has(7) &&
        !useProjectStore.getState().startingTaskNumbers.has(8),
    );

    // Both tasks spawned a terminal — no start hook was silently dropped.
    expect(addProjectTerminal).toHaveBeenCalledTimes(2);
    expect(useProjectStore.getState().runHookQueueTotal).toBe(0);
  });
});

describe('projectStore runHook queue', () => {
  beforeEach(() => {
    useProjectStore.getState().resetForProject();
  });

  const makeReq = (taskNumber: number) => ({
    projectPath: PROJECT,
    hookType: 'start' as const,
    hook: { command: `cmd-${taskNumber}`, name: 'Start', source: 'configured' as const, priority: 0 },
    task: { taskNumber, name: `Task ${taskNumber}`, status: 'todo' as const, order: 0, createdAt: '' },
  });

  test('requestRunHook appends instead of evicting the prior prompt', async () => {
    const store = useProjectStore.getState();
    const p1 = store.requestRunHook(makeReq(1));
    const p2 = store.requestRunHook(makeReq(2));

    expect(useProjectStore.getState().runHookQueue.map((r) => r.task.taskNumber)).toEqual([1, 2]);
    expect(useProjectStore.getState().runHookQueueTotal).toBe(2);

    useProjectStore.getState().resolveRunHookRequest(useProjectStore.getState().runHookQueue[0]!.id, null);
    await expect(p1).resolves.toBeNull();
    expect(useProjectStore.getState().runHookQueue.map((r) => r.task.taskNumber)).toEqual([2]);

    useProjectStore.getState().resolveRunHookRequest(useProjectStore.getState().runHookQueue[0]!.id, null);
    await expect(p2).resolves.toBeNull();
    expect(useProjectStore.getState().runHookQueueTotal).toBe(0);
  });

  test('skipAllRunHookRequests resolves every queued prompt with null', async () => {
    const store = useProjectStore.getState();
    const promises = [
      store.requestRunHook(makeReq(1)),
      store.requestRunHook(makeReq(2)),
      store.requestRunHook(makeReq(3)),
    ];

    useProjectStore.getState().skipAllRunHookRequests();

    await expect(Promise.all(promises)).resolves.toEqual([null, null, null]);
    expect(useProjectStore.getState().runHookQueue).toHaveLength(0);
    expect(useProjectStore.getState().runHookQueueTotal).toBe(0);
  });

  test('runAllRunHookRequests applies headResult to the head and defaults to the rest', async () => {
    const store = useProjectStore.getState();
    const p1 = store.requestRunHook(makeReq(1));
    const p2 = store.requestRunHook(makeReq(2));

    const headResult = { command: 'edited', sandboxed: true, foreground: true };
    useProjectStore.getState().runAllRunHookRequests(headResult);

    await expect(p1).resolves.toEqual(headResult);
    await expect(p2).resolves.toEqual({ command: 'cmd-2', sandboxed: false, foreground: false });
    expect(useProjectStore.getState().runHookQueue).toHaveLength(0);
    expect(useProjectStore.getState().runHookQueueTotal).toBe(0);
  });
});
