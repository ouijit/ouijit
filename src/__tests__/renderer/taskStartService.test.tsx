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
import { addProjectTerminal } from '../../components/terminal/terminalActions';
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
    await waitFor(() => useProjectStore.getState().runHookRequest != null);
    const req = useProjectStore.getState().runHookRequest!;
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

    await waitFor(() => useProjectStore.getState().runHookRequest != null);
    const req = useProjectStore.getState().runHookRequest!;
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

    await waitFor(() => useProjectStore.getState().runHookRequest != null);
    const req = useProjectStore.getState().runHookRequest!;
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

    await waitFor(() => useProjectStore.getState().runHookRequest != null);
    const req = useProjectStore.getState().runHookRequest!;
    useProjectStore
      .getState()
      .resolveRunHookRequest(req.id, { command: 'npm ci', sandboxed: false, foreground: false });

    await waitFor(() => !useProjectStore.getState().startingTaskNumbers.has(7));

    expect(onForegroundOpen).not.toHaveBeenCalled();
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
});
