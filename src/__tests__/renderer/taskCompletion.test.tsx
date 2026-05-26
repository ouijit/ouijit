import { describe, test, expect, beforeEach, vi } from 'vitest';

vi.mock('electron-log/renderer', () => ({
  default: { scope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('../../components/terminal/terminalActions', () => ({
  addProjectTerminal: vi.fn().mockResolvedValue(true),
  closeProjectTerminal: vi.fn(),
}));

import { useAppStore } from '../../stores/appStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { completeTask } from '../../services/taskCompletion';
import { addProjectTerminal, closeProjectTerminal } from '../../components/terminal/terminalActions';
import type { TaskWithWorkspace } from '../../types';

const PROJECT = '/project';

function makeTask(overrides: Partial<TaskWithWorkspace> = {}): TaskWithWorkspace {
  return {
    taskNumber: 7,
    name: 'Wire up auth',
    status: 'in_review',
    order: 0,
    createdAt: '2026-01-01T00:00:00Z',
    worktreePath: '/wt/T-7',
    branch: 'wire-up-auth-7',
    ...overrides,
  };
}

describe('completeTask', () => {
  beforeEach(() => {
    useProjectStore.getState().resetForProject();
    useTerminalStore.setState({ terminalsByProject: {}, displayStates: {}, activeIndices: {} });
    useAppStore.setState({ activeProjectPath: PROJECT });
    vi.clearAllMocks();
    vi.mocked(window.api.hooks.get).mockResolvedValue({});
    vi.mocked(window.api.task.setStatus).mockResolvedValue({ success: true });
    vi.mocked(window.api.task.getAll).mockResolvedValue([]);
  });

  test('snapshot-before-spawn: pre-existing task terminals close, the new hook terminal survives', async () => {
    useTerminalStore.getState().addTerminal(PROJECT, 'pty-old', { label: 'old', taskId: 7 });

    vi.mocked(window.api.hooks.get).mockResolvedValue({
      done: { command: 'echo hey', name: 'Done', source: 'configured', priority: 0 },
    });

    vi.mocked(addProjectTerminal).mockImplementation(async () => {
      useTerminalStore.getState().addTerminal(PROJECT, 'pty-hook', { label: 'Done', taskId: 7 });
      return true;
    });

    await completeTask({ projectPath: PROJECT, task: makeTask() });

    expect(vi.mocked(addProjectTerminal).mock.calls[0][1]).toMatchObject({ name: 'Done', command: 'echo hey' });
    // The hook terminal opts into autoCloseOnSuccess. The OSC 133 emitted by
    // our shell-integration precmd hook (see hookServer.ZSH_INTEGRATION /
    // BASH_INTEGRATION) provides the exit-code signal — the PTY stays alive
    // in an interactive shell after the command so failures are debuggable.
    expect(vi.mocked(addProjectTerminal).mock.calls[0][2]).toMatchObject({
      autoCloseOnSuccess: true,
    });
    // Only the pre-existing terminal is closed; the freshly spawned hook terminal survives.
    expect(vi.mocked(closeProjectTerminal).mock.calls.map((c) => c[0])).toEqual(['pty-old']);
  });

  test('no hook configured: closes task terminals, writes status, no spawn', async () => {
    useTerminalStore.getState().addTerminal(PROJECT, 'pty-a', { label: 'a', taskId: 7 });
    useTerminalStore.getState().addTerminal(PROJECT, 'pty-b', { label: 'b', taskId: 7 });

    await completeTask({ projectPath: PROJECT, task: makeTask() });

    expect(addProjectTerminal).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(closeProjectTerminal)
        .mock.calls.map((c) => c[0])
        .sort(),
    ).toEqual(['pty-a', 'pty-b']);
    expect(window.api.task.setStatus).toHaveBeenCalledWith(PROJECT, 7, 'done');
  });

  test('skipHook: configured hook is bypassed', async () => {
    vi.mocked(window.api.hooks.get).mockResolvedValue({
      done: { command: 'echo hey', name: 'Done', source: 'configured', priority: 0 },
    });

    await completeTask({ projectPath: PROJECT, task: makeTask(), skipHook: true });

    expect(addProjectTerminal).not.toHaveBeenCalled();
    expect(window.api.task.setStatus).toHaveBeenCalledWith(PROJECT, 7, 'done');
  });

  test('hookCommand: overrides the configured command for this transition', async () => {
    vi.mocked(window.api.hooks.get).mockResolvedValue({
      done: { command: 'echo configured', name: 'Done', source: 'configured', priority: 0 },
    });

    await completeTask({ projectPath: PROJECT, task: makeTask(), hookCommand: 'echo override' });

    expect(vi.mocked(addProjectTerminal).mock.calls[0][1]).toMatchObject({
      name: 'Done',
      command: 'echo override',
    });
  });

  test('hookCommand wins even when skipHook is also true', async () => {
    vi.mocked(window.api.hooks.get).mockResolvedValue({
      done: { command: 'echo configured', name: 'Done', source: 'configured', priority: 0 },
    });

    await completeTask({
      projectPath: PROJECT,
      task: makeTask(),
      skipHook: true,
      hookCommand: 'echo explicit',
    });

    expect(vi.mocked(addProjectTerminal).mock.calls[0][1]).toMatchObject({ command: 'echo explicit' });
  });

  test('targetIndex: routes through moveTask (status + order) instead of bare setStatus', async () => {
    const moveTaskSpy = vi.spyOn(useProjectStore.getState(), 'moveTask').mockImplementation(async () => undefined);

    await completeTask({ projectPath: PROJECT, task: makeTask(), targetIndex: 2 });

    expect(moveTaskSpy).toHaveBeenCalledWith(PROJECT, 7, 'done', 2);
    expect(window.api.task.setStatus).not.toHaveBeenCalled();
  });

  test('loading terminals are excluded from the snapshot', async () => {
    useTerminalStore.getState().addTerminal(PROJECT, 'pty-loading', {
      label: 'loading',
      taskId: 7,
      isLoading: true,
    });
    useTerminalStore.getState().addTerminal(PROJECT, 'pty-real', { label: 'real', taskId: 7 });

    await completeTask({ projectPath: PROJECT, task: makeTask() });

    expect(vi.mocked(closeProjectTerminal).mock.calls.map((c) => c[0])).toEqual(['pty-real']);
  });

  test('no worktree: skips the hook spawn but still writes status', async () => {
    vi.mocked(window.api.hooks.get).mockResolvedValue({
      done: { command: 'echo hey', name: 'Done', source: 'configured', priority: 0 },
    });

    await completeTask({ projectPath: PROJECT, task: makeTask({ worktreePath: undefined }) });

    expect(addProjectTerminal).not.toHaveBeenCalled();
    expect(window.api.task.setStatus).toHaveBeenCalledWith(PROJECT, 7, 'done');
  });

  test('terminals belonging to other tasks are not touched', async () => {
    useTerminalStore.getState().addTerminal(PROJECT, 'pty-mine', { label: 'mine', taskId: 7 });
    useTerminalStore.getState().addTerminal(PROJECT, 'pty-other', { label: 'other', taskId: 99 });
    useTerminalStore.getState().addTerminal(PROJECT, 'pty-nontask', { label: 'shell' });

    await completeTask({ projectPath: PROJECT, task: makeTask() });

    expect(vi.mocked(closeProjectTerminal).mock.calls.map((c) => c[0])).toEqual(['pty-mine']);
  });

  test('concurrent calls for the same task collapse to a single lifecycle', async () => {
    // Reproduces the race between e.g. a shift-drag and the CLI's
    // cli:task-completed push landing for the same task. Without the gate,
    // each call snapshots the other's freshly-spawned hook terminal.
    useTerminalStore.getState().addTerminal(PROJECT, 'pty-old', { label: 'old', taskId: 7 });
    vi.mocked(window.api.hooks.get).mockResolvedValue({
      done: { command: 'echo hey', name: 'Done', source: 'configured', priority: 0 },
    });
    let spawnCount = 0;
    vi.mocked(addProjectTerminal).mockImplementation(async () => {
      spawnCount++;
      useTerminalStore.getState().addTerminal(PROJECT, `pty-hook-${spawnCount}`, { label: 'Done', taskId: 7 });
      return true;
    });

    const task = makeTask();
    await Promise.all([
      completeTask({ projectPath: PROJECT, task }),
      completeTask({ projectPath: PROJECT, task }),
      completeTask({ projectPath: PROJECT, task }),
    ]);

    expect(spawnCount).toBe(1);
    expect(window.api.task.setStatus).toHaveBeenCalledTimes(1);
    // The pre-existing terminal closes once; the single freshly-spawned hook
    // terminal survives.
    expect(vi.mocked(closeProjectTerminal).mock.calls.map((c) => c[0])).toEqual(['pty-old']);
  });

  test('after completion, a later call runs again (gate clears)', async () => {
    await completeTask({ projectPath: PROJECT, task: makeTask() });
    await completeTask({ projectPath: PROJECT, task: makeTask() });

    expect(window.api.task.setStatus).toHaveBeenCalledTimes(2);
  });

  test('cross-project call does not clobber the active project task list', async () => {
    // projectStore.tasks is a singleton holding the active project's tasks.
    // Calling loadTasks() for a non-active project would overwrite them with
    // the wrong project's data. Today useIPCListeners gates this out before
    // completeTask is called, but the guard inside completeTask is the
    // backstop against future callers.
    useAppStore.setState({ activeProjectPath: '/other-project' });
    await completeTask({ projectPath: PROJECT, task: makeTask() });

    expect(window.api.task.getAll).not.toHaveBeenCalled();
  });
});
