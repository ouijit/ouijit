import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/react';

vi.mock('electron-log/renderer', () => ({
  default: { scope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// Mock beginTransition so we can assert routing without spinning up the
// real worktree / hook lifecycle.
vi.mock('../../services/taskStartService', () => ({
  beginTransition: vi.fn(),
}));

import { useProjectStore } from '../../stores/projectStore';
import { BulkActionBar } from '../../components/kanban/BulkActionBar';
import { beginTransition } from '../../services/taskStartService';
import type { TaskWithWorkspace } from '../../types';

const PROJECT = '/project';

function task(
  taskNumber: number,
  status: TaskWithWorkspace['status'],
  extras: Partial<TaskWithWorkspace> = {},
): TaskWithWorkspace {
  return {
    taskNumber,
    name: `Task ${taskNumber}`,
    status,
    order: 0,
    createdAt: '2026-01-01T00:00:00Z',
    ...extras,
  };
}

describe('BulkActionBar.handleMoveToStatus', () => {
  beforeEach(() => {
    useProjectStore.getState().resetForProject();
    // resetForProject intentionally preserves toasts across project switches —
    // clear them here so each test asserts only on its own emissions.
    useProjectStore.setState({ toasts: [] });
    vi.clearAllMocks();
    vi.mocked(window.api.task.setStatus).mockResolvedValue({ success: true });
    vi.mocked(window.api.task.getAll).mockResolvedValue([]);
  });

  test('routes each selected task through beginTransition with the snapshotted origStatus', async () => {
    const t1 = task(1, 'todo');
    const t2 = task(2, 'todo');
    const t3 = task(3, 'in_review'); // different orig status — proves per-task snapshot
    useProjectStore.setState({
      tasks: [t1, t2, t3],
      selectedTaskNumbers: new Set([1, 2, 3]),
    });

    render(<BulkActionBar projectPath={PROJECT} onOpenTerminal={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'In Progress' }));

    // Each task is persisted to its new status — note we don't persist
    // tasks that are already in the target column, but here all three
    // differ from in_progress so all three get setStatus.
    await vi.waitFor(() => expect(window.api.task.setStatus).toHaveBeenCalledTimes(3));
    expect(vi.mocked(window.api.task.setStatus).mock.calls.map((c) => [c[1], c[2]])).toEqual(
      expect.arrayContaining([
        [1, 'in_progress'],
        [2, 'in_progress'],
        [3, 'in_progress'],
      ]),
    );

    // Each transition hands off to the start service with the ORIGINAL status,
    // so the service can distinguish start (todo→in_progress) from continue
    // (in_review→in_progress) and run the right hook.
    await vi.waitFor(() => expect(beginTransition).toHaveBeenCalledTimes(3));
    const calls = vi.mocked(beginTransition).mock.calls;
    const byTask = new Map(calls.map((c) => [c[1].task.taskNumber, c[1]]));
    expect(byTask.get(1)).toMatchObject({ origStatus: 'todo', newStatus: 'in_progress' });
    expect(byTask.get(2)).toMatchObject({ origStatus: 'todo', newStatus: 'in_progress' });
    expect(byTask.get(3)).toMatchObject({ origStatus: 'in_review', newStatus: 'in_progress' });

    // Selection cleared after the bulk action.
    expect(useProjectStore.getState().selectedTaskNumbers.size).toBe(0);
  });

  test('skips tasks already in the target column', async () => {
    useProjectStore.setState({
      tasks: [task(1, 'done'), task(2, 'in_review')],
      selectedTaskNumbers: new Set([1, 2]),
    });

    render(<BulkActionBar projectPath={PROJECT} onOpenTerminal={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    await vi.waitFor(() => expect(beginTransition).toHaveBeenCalledTimes(1));
    // Only task 2 (in_review → done) transitions; task 1 was already done.
    expect(vi.mocked(beginTransition).mock.calls[0][1].task.taskNumber).toBe(2);
    expect(window.api.task.setStatus).toHaveBeenCalledTimes(1);
    expect(vi.mocked(window.api.task.setStatus).mock.calls[0][1]).toBe(2);
  });

  test('toast reflects the number of tasks that actually transitioned, not the selection size', async () => {
    useProjectStore.setState({
      tasks: [task(1, 'in_review'), task(2, 'in_review'), task(3, 'in_review')],
      selectedTaskNumbers: new Set([1, 2, 3]),
    });

    // The "In Review" button is filtered out when all selected share that status,
    // so use the "Done" button to push all three forward.
    render(<BulkActionBar projectPath={PROJECT} onOpenTerminal={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    await vi.waitFor(() => expect(useProjectStore.getState().toasts).toHaveLength(1));
    expect(useProjectStore.getState().toasts[0].message).toBe('Moved 3 tasks to Done');
  });

  test('hides the button for the status all selected tasks share', () => {
    useProjectStore.setState({
      tasks: [task(1, 'todo'), task(2, 'todo')],
      selectedTaskNumbers: new Set([1, 2]),
    });

    render(<BulkActionBar projectPath={PROJECT} onOpenTerminal={vi.fn()} />);
    // "To Do" button should be hidden since both are already in todo.
    expect(screen.queryByRole('button', { name: 'To Do' })).toBeNull();
    expect(screen.getByRole('button', { name: 'In Progress' })).toBeTruthy();
    cleanup();
  });
});
