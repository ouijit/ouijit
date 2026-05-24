import { describe, test, expect, beforeEach, vi } from 'vitest';

vi.mock('electron-log/renderer', () => ({
  default: { scope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// The bulk helper internally fans out to beginTransition. Mock the rest of
// that lifecycle (terminal spawn etc.) so the assertions stay focused on the
// orchestration the helper itself owns: snapshot, persist, refetch, hand off.
vi.mock('../../components/terminal/terminalActions', () => ({
  addProjectTerminal: vi.fn().mockResolvedValue(true),
  closeProjectTerminal: vi.fn(),
}));

import { useProjectStore } from '../../stores/projectStore';
import { bulkTransitionTasks } from '../../services/taskStartService';
import type { TaskWithWorkspace, TaskStatus } from '../../types';

const PROJECT = '/project';

function task(taskNumber: number, status: TaskStatus, extras: Partial<TaskWithWorkspace> = {}): TaskWithWorkspace {
  return {
    taskNumber,
    name: `Task ${taskNumber}`,
    status,
    order: 0,
    createdAt: '2026-01-01T00:00:00Z',
    ...extras,
  };
}

describe('bulkTransitionTasks', () => {
  beforeEach(() => {
    useProjectStore.getState().resetForProject();
    // resetForProject intentionally preserves toasts across project switches;
    // start each test from a clean toast list.
    useProjectStore.setState({ toasts: [] });
    vi.clearAllMocks();
    vi.mocked(window.api.task.setStatus).mockResolvedValue({ success: true });
    vi.mocked(window.api.task.getAll).mockResolvedValue([]);
    vi.mocked(window.api.hooks.get).mockResolvedValue({});
    vi.mocked(window.api.task.start).mockResolvedValue({
      success: true,
      worktreePath: '/wt/T-0',
      task: { taskNumber: 0, name: '', branch: '', status: 'in_progress', createdAt: '' },
    });
  });

  test('snapshots origStatus per task before mutating', async () => {
    // Mixed starting columns — proves the per-task snapshot rather than a
    // shared "from" column. If origStatus were derived after the setStatus
    // round-trip, every task would look like it came from in_progress.
    useProjectStore.setState({
      tasks: [task(1, 'todo'), task(2, 'in_review'), task(3, 'todo')],
      selectedTaskNumbers: new Set([1, 2, 3]),
    });

    const transitions = await bulkTransitionTasks(PROJECT, [1, 2, 3], 'in_progress');

    expect(transitions).toEqual([
      { task: expect.objectContaining({ taskNumber: 1 }), origStatus: 'todo' },
      { task: expect.objectContaining({ taskNumber: 2 }), origStatus: 'in_review' },
      { task: expect.objectContaining({ taskNumber: 3 }), origStatus: 'todo' },
    ]);
  });

  test('persists setStatus for each transitioning task in parallel', async () => {
    useProjectStore.setState({
      tasks: [task(1, 'todo'), task(2, 'todo')],
      selectedTaskNumbers: new Set([1, 2]),
    });

    await bulkTransitionTasks(PROJECT, [1, 2], 'in_progress');

    expect(window.api.task.setStatus).toHaveBeenCalledTimes(2);
    expect(vi.mocked(window.api.task.setStatus).mock.calls.map((c) => [c[1], c[2]])).toEqual(
      expect.arrayContaining([
        [1, 'in_progress'],
        [2, 'in_progress'],
      ]),
    );
  });

  test('skips tasks already in the target column', async () => {
    useProjectStore.setState({
      tasks: [task(1, 'done'), task(2, 'in_review')],
      selectedTaskNumbers: new Set([1, 2]),
    });

    const transitions = await bulkTransitionTasks(PROJECT, [1, 2], 'done');

    expect(transitions.map((t) => t.task.taskNumber)).toEqual([2]);
    // Task 1 was already done — neither setStatus nor the downstream
    // lifecycle should fire for it.
    expect(window.api.task.setStatus).toHaveBeenCalledTimes(1);
    expect(vi.mocked(window.api.task.setStatus).mock.calls[0][1]).toBe(2);
  });

  test('drops unknown task numbers (selection out of sync with task list)', async () => {
    useProjectStore.setState({
      tasks: [task(1, 'todo')],
      selectedTaskNumbers: new Set([1, 999]),
    });

    const transitions = await bulkTransitionTasks(PROJECT, [1, 999], 'in_progress');

    expect(transitions.map((t) => t.task.taskNumber)).toEqual([1]);
    expect(window.api.task.setStatus).toHaveBeenCalledTimes(1);
  });

  test('reloads tasks and clears selection as side effects', async () => {
    useProjectStore.setState({
      tasks: [task(1, 'todo')],
      selectedTaskNumbers: new Set([1]),
    });

    await bulkTransitionTasks(PROJECT, [1], 'in_progress');

    expect(window.api.task.getAll).toHaveBeenCalledWith(PROJECT);
    expect(useProjectStore.getState().selectedTaskNumbers.size).toBe(0);
  });

  test('emits a success toast counting actual transitions, not the selection size', async () => {
    useProjectStore.setState({
      tasks: [task(1, 'done'), task(2, 'in_review'), task(3, 'in_review')],
      selectedTaskNumbers: new Set([1, 2, 3]),
    });

    // Task 1 already done → 2 actual transitions, even though 3 were selected.
    await bulkTransitionTasks(PROJECT, [1, 2, 3], 'done');

    expect(useProjectStore.getState().toasts).toHaveLength(1);
    expect(useProjectStore.getState().toasts[0]).toMatchObject({
      message: 'Moved 2 tasks to Done',
      type: 'success',
    });
  });

  test('queues a hook dialog per transitioning task when a hook is configured', async () => {
    vi.mocked(window.api.hooks.get).mockResolvedValue({
      start: { command: 'npm install', name: 'Start', source: 'configured', priority: 0 },
    });
    useProjectStore.setState({
      tasks: [task(1, 'todo'), task(2, 'todo')],
      selectedTaskNumbers: new Set([1, 2]),
    });

    await bulkTransitionTasks(PROJECT, [1, 2], 'in_progress');

    // beginTransition is async — wait for both requests to land in the queue.
    await vi.waitFor(() => expect(useProjectStore.getState().runHookQueue).toHaveLength(2));
    expect(useProjectStore.getState().runHookQueueTotal).toBe(2);
    expect(useProjectStore.getState().runHookQueue.map((r) => r.task.taskNumber)).toEqual([1, 2]);
  });

  test('a no-op bulk action (all selected already in target) emits a "Moved 0" toast and no IPC', async () => {
    useProjectStore.setState({
      tasks: [task(1, 'done'), task(2, 'done')],
      selectedTaskNumbers: new Set([1, 2]),
    });

    const transitions = await bulkTransitionTasks(PROJECT, [1, 2], 'done');

    expect(transitions).toEqual([]);
    expect(window.api.task.setStatus).not.toHaveBeenCalled();
    expect(useProjectStore.getState().toasts[0].message).toBe('Moved 0 tasks to Done');
  });
});
