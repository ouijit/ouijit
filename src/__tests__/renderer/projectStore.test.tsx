import { describe, test, expect, beforeEach, vi } from 'vitest';
import { useProjectStore } from '../../stores/projectStore';
import type { TaskWithWorkspace } from '../../types';

function makeTask(taskNumber: number, status: string, order: number): TaskWithWorkspace {
  return {
    taskNumber,
    name: `Task ${taskNumber}`,
    status: status as TaskWithWorkspace['status'],
    order,
    createdAt: '2026-01-01T00:00:00Z',
  };
}

describe('projectStore.moveTask', () => {
  beforeEach(() => {
    useProjectStore.setState({ tasks: [], _version: 0, toasts: [] });
    vi.mocked(window.api.task.reorder).mockResolvedValue({ success: true });
  });

  test('optimistic update sets order fields matching new positions', async () => {
    const tasks = [makeTask(1, 'todo', 0), makeTask(2, 'todo', 1), makeTask(3, 'in_progress', 0)];
    useProjectStore.setState({ tasks });

    // Move task 1 from todo to in_progress at index 1 (after task 3)
    const promise = useProjectStore.getState().moveTask('/project', 1, 'in_progress', 1);

    // Check optimistic state before the API resolves
    const updated = useProjectStore.getState().tasks;
    const inProgress = updated.filter((t) => t.status === 'in_progress');
    inProgress.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    expect(inProgress).toHaveLength(2);
    expect(inProgress[0].taskNumber).toBe(3);
    expect(inProgress[0].order).toBe(0);
    expect(inProgress[1].taskNumber).toBe(1);
    expect(inProgress[1].order).toBe(1);

    await promise;
  });

  test('optimistic reorder within the same column updates order fields', async () => {
    const tasks = [makeTask(1, 'todo', 0), makeTask(2, 'todo', 1), makeTask(3, 'todo', 2)];
    useProjectStore.setState({ tasks });

    // Move task 1 to index 2 (end of todo column)
    const promise = useProjectStore.getState().moveTask('/project', 1, 'todo', 2);

    const updated = useProjectStore.getState().tasks;
    const todo = updated.filter((t) => t.status === 'todo');
    todo.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    expect(todo.map((t) => t.taskNumber)).toEqual([2, 3, 1]);
    expect(todo.map((t) => t.order)).toEqual([0, 1, 2]);

    await promise;
  });

  test('rolls back on API failure', async () => {
    vi.mocked(window.api.task.reorder).mockResolvedValue({ success: false });

    const tasks = [makeTask(1, 'todo', 0), makeTask(2, 'in_progress', 0)];
    useProjectStore.setState({ tasks });

    await useProjectStore.getState().moveTask('/project', 1, 'in_progress', 0);

    const rolled = useProjectStore.getState().tasks;
    expect(rolled).toEqual(tasks);
  });
});
