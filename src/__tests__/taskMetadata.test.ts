import { describe, test, expect } from 'vitest';
import {
  createTask,
  getProjectTasks,
  getTask,
  getTaskByNumber,
  getNextTaskNumber,
  setTaskStatus,
  setTaskMergeTarget,
  setTaskSandboxed,
  setTaskName,
  setTaskDescription,
  deleteTaskByNumber,
  reorderTask,
} from '../db';

describe('taskMetadata', () => {
  test('createTask and getProjectTasks round-trip', async () => {
    const project = '/test/create-roundtrip';
    const task = await createTask(project, 1, 'Add login', {
      branch: 'feat/login',
      mergeTarget: 'main',
      prompt: 'Build login page',
      sandboxed: true,
    });

    expect(task.taskNumber).toBe(1);
    expect(task.branch).toBe('feat/login');
    expect(task.name).toBe('Add login');
    expect(task.status).toBe('in_progress');
    expect(task.createdAt).toBeTruthy();
    expect(task.mergeTarget).toBe('main');
    expect(task.prompt).toBe('Build login page');
    expect(task.sandboxed).toBe(true);

    const tasks = await getProjectTasks(project);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].taskNumber).toBe(1);

    const nextNum = await getNextTaskNumber(project);
    expect(nextNum).toBe(2);
  });

  test('getTask looks up by branch', async () => {
    const project = '/test/get-by-branch';
    await createTask(project, 1, 'Search feature', { branch: 'feat/search' });

    const found = await getTask(project, 'feat/search');
    expect(found).not.toBeNull();
    expect(found!.name).toBe('Search feature');

    const notFound = await getTask(project, 'nonexistent');
    expect(notFound).toBeNull();
  });

  test('getTaskByNumber looks up by taskNumber', async () => {
    const project = '/test/get-by-number';
    await createTask(project, 5, 'Task five', { branch: 'feat/five' });

    const found = await getTaskByNumber(project, 5);
    expect(found).not.toBeNull();
    expect(found!.name).toBe('Task five');

    const notFound = await getTaskByNumber(project, 99);
    expect(notFound).toBeNull();
  });

  test('setTaskStatus toggles between statuses', async () => {
    const project = '/test/status-toggle';
    await createTask(project, 1, 'Toggle task', { branch: 'feat/toggle' });

    await setTaskStatus(project, 1, 'done');
    let task = await getTaskByNumber(project, 1);
    expect(task!.status).toBe('done');
    expect(task!.closedAt).toBeTruthy();

    await setTaskStatus(project, 1, 'in_progress');
    task = await getTaskByNumber(project, 1);
    expect(task!.status).toBe('in_progress');
    expect(task!.closedAt).toBeUndefined();
  });

  test('setTaskStatus to in_review works', async () => {
    const project = '/test/in-review';
    await createTask(project, 1, 'Review task', { branch: 'feat/review' });

    await setTaskStatus(project, 1, 'in_review');
    const task = await getTaskByNumber(project, 1);
    expect(task!.status).toBe('in_review');
  });

  test('setTaskMergeTarget persists', async () => {
    const project = '/test/merge-target';
    await createTask(project, 1, 'Merge target task', { branch: 'feat/mt' });

    await setTaskMergeTarget(project, 1, 'develop');
    const task = await getTaskByNumber(project, 1);
    expect(task!.mergeTarget).toBe('develop');
  });

  test('setTaskSandboxed toggles the flag', async () => {
    const project = '/test/sandboxed';
    await createTask(project, 1, 'Sandbox task', { branch: 'feat/sb' });

    await setTaskSandboxed(project, 1, true);
    let task = await getTaskByNumber(project, 1);
    expect(task!.sandboxed).toBe(true);

    await setTaskSandboxed(project, 1, false);
    task = await getTaskByNumber(project, 1);
    expect(task!.sandboxed).toBeUndefined();
  });

  test('deleteTaskByNumber removes the task', async () => {
    const project = '/test/delete-by-number';
    await createTask(project, 1, 'Delete me', { branch: 'feat/del' });

    const result = await deleteTaskByNumber(project, 1);
    expect(result.success).toBe(true);

    const task = await getTaskByNumber(project, 1);
    expect(task).toBeNull();
  });

  test('getProjectTasks sorts by status then createdAt', async () => {
    const project = '/test/sort-order';

    await createTask(project, 1, 'In progress old');
    await new Promise((r) => setTimeout(r, 10));
    await createTask(project, 2, 'In progress new');
    await new Promise((r) => setTimeout(r, 10));
    await createTask(project, 3, 'Done old');
    await setTaskStatus(project, 3, 'done');
    await new Promise((r) => setTimeout(r, 10));
    await createTask(project, 4, 'Done new');
    await setTaskStatus(project, 4, 'done');

    const tasks = await getProjectTasks(project);
    expect(tasks).toHaveLength(4);

    // in_progress first (sorted by order)
    expect(tasks[0].name).toBe('In progress old');
    expect(tasks[1].name).toBe('In progress new');
    // Then done (sorted by order)
    expect(tasks[2].name).toBe('Done old');
    expect(tasks[3].name).toBe('Done new');
  });

  test('multiple projects are isolated', async () => {
    const projectA = '/test/isolation-a';
    const projectB = '/test/isolation-b';

    await createTask(projectA, 1, 'Task A', { branch: 'feat/a' });
    await createTask(projectB, 1, 'Task B', { branch: 'feat/b' });

    const tasksA = await getProjectTasks(projectA);
    const tasksB = await getProjectTasks(projectB);

    expect(tasksA).toHaveLength(1);
    expect(tasksA[0].name).toBe('Task A');

    expect(tasksB).toHaveLength(1);
    expect(tasksB[0].name).toBe('Task B');
  });

  test('setTaskName updates the task name', async () => {
    const project = '/test/set-name';
    await createTask(project, 1, 'Original name', { branch: 'feat/name' });

    const result = await setTaskName(project, 1, 'Updated name');
    expect(result.success).toBe(true);

    const task = await getTaskByNumber(project, 1);
    expect(task!.name).toBe('Updated name');
  });

  test('setTaskName returns error for missing task', async () => {
    const project = '/test/set-name-missing';
    await createTask(project, 1, 'Exists');
    const result = await setTaskName(project, 99, 'No task');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Task not found');
  });

  test('setTaskDescription sets a description', async () => {
    const project = '/test/set-description';
    await createTask(project, 1, 'Desc task', { branch: 'feat/desc' });

    const result = await setTaskDescription(project, 1, 'New description');
    expect(result.success).toBe(true);

    const task = await getTaskByNumber(project, 1);
    expect(task!.prompt).toBe('New description');
  });

  test('setTaskDescription with empty string clears the description', async () => {
    const project = '/test/set-description-clear';
    await createTask(project, 1, 'Clear desc task', { branch: 'feat/clear', prompt: 'Has a description' });

    const result = await setTaskDescription(project, 1, '');
    expect(result.success).toBe(true);

    const task = await getTaskByNumber(project, 1);
    expect(task!.prompt).toBeUndefined();
  });

  test('setTaskName is visible via getProjectTasks', async () => {
    const project = '/test/name-propagates';
    await createTask(project, 1, 'Original', { branch: 'feat/orig' });

    await setTaskName(project, 1, 'Renamed');

    const tasks = await getProjectTasks(project);
    expect(tasks[0].name).toBe('Renamed');
  });

  test('createTask with todo status (no branch)', async () => {
    const project = '/test/todo-task';
    const task = await createTask(project, 1, 'Plan feature', { status: 'todo' });

    expect(task.status).toBe('todo');
    expect(task.branch).toBeUndefined();
  });

  test('createTask assigns sequential order values', async () => {
    const project = '/test/order-assignment';
    const t1 = await createTask(project, 1, 'First', { status: 'todo' });
    const t2 = await createTask(project, 2, 'Second', { status: 'todo' });
    const t3 = await createTask(project, 3, 'Third', { status: 'in_progress' });

    expect(t1.order).toBe(0);
    expect(t2.order).toBe(1);
    expect(t3.order).toBe(0); // different status column
  });

  test('reorderTask within same column', async () => {
    const project = '/test/reorder-same';
    await createTask(project, 1, 'A', { status: 'todo' });
    await createTask(project, 2, 'B', { status: 'todo' });
    await createTask(project, 3, 'C', { status: 'todo' });

    // Move task 3 (index 2) to index 0
    const result = await reorderTask(project, 3, 'todo', 0);
    expect(result.success).toBe(true);

    const tasks = await getProjectTasks(project);
    const todoTasks = tasks.filter((t) => t.status === 'todo');
    expect(todoTasks.map((t) => t.taskNumber)).toEqual([3, 1, 2]);
  });

  test('reorderTask across columns', async () => {
    const project = '/test/reorder-across';
    await createTask(project, 1, 'A', { status: 'todo' });
    await createTask(project, 2, 'B', { status: 'todo' });
    await createTask(project, 3, 'C', { status: 'in_progress' });
    await createTask(project, 4, 'D', { status: 'in_progress' });

    // Move task 1 from todo to in_progress at index 1
    const result = await reorderTask(project, 1, 'in_progress', 1);
    expect(result.success).toBe(true);

    const tasks = await getProjectTasks(project);
    const todoTasks = tasks.filter((t) => t.status === 'todo');
    const ipTasks = tasks.filter((t) => t.status === 'in_progress');

    expect(todoTasks.map((t) => t.taskNumber)).toEqual([2]);
    expect(ipTasks.map((t) => t.taskNumber)).toEqual([3, 1, 4]);
  });

  test('reorderTask to done sets closedAt', async () => {
    const project = '/test/reorder-done';
    await createTask(project, 1, 'Task', { status: 'in_progress' });

    await reorderTask(project, 1, 'done', 0);
    const task = await getTaskByNumber(project, 1);
    expect(task!.status).toBe('done');
    expect(task!.closedAt).toBeTruthy();
  });

  test('reorderTask from done clears closedAt', async () => {
    const project = '/test/reorder-from-done';
    await createTask(project, 1, 'Task', { status: 'done' });
    // Manually set closedAt via setTaskStatus first
    await setTaskStatus(project, 1, 'done');

    await reorderTask(project, 1, 'in_progress', 0);
    const task = await getTaskByNumber(project, 1);
    expect(task!.status).toBe('in_progress');
    expect(task!.closedAt).toBeUndefined();
  });

  test('getProjectTasks sorts by order within same status', async () => {
    const project = '/test/sort-by-order';
    await createTask(project, 1, 'First', { status: 'todo' });
    await createTask(project, 2, 'Second', { status: 'todo' });
    await createTask(project, 3, 'Third', { status: 'todo' });

    // Reverse the order: move task 3 to front, task 1 to end
    await reorderTask(project, 3, 'todo', 0);

    const tasks = await getProjectTasks(project);
    const todoTasks = tasks.filter((t) => t.status === 'todo');
    expect(todoTasks.map((t) => t.name)).toEqual(['Third', 'First', 'Second']);
  });

  test('setTaskStatus appends to end of target column', async () => {
    const project = '/test/status-append';
    await createTask(project, 1, 'A', { status: 'in_progress' });
    await createTask(project, 2, 'B', { status: 'in_progress' });
    // Give them explicit orders via reorder
    await reorderTask(project, 1, 'in_progress', 0);
    await reorderTask(project, 2, 'in_progress', 1);

    // Create a task in todo and move it via setTaskStatus
    await createTask(project, 3, 'C', { status: 'todo' });
    await setTaskStatus(project, 3, 'in_progress');

    const task3 = await getTaskByNumber(project, 3);
    expect(task3!.order).toBe(2); // appended after 0, 1
  });

  test('setTaskStatus compacts old column orders', async () => {
    const project = '/test/status-compact';
    await createTask(project, 1, 'A', { status: 'todo' });
    await createTask(project, 2, 'B', { status: 'todo' });
    await createTask(project, 3, 'C', { status: 'todo' });
    // Give them explicit orders
    await reorderTask(project, 1, 'todo', 0);
    await reorderTask(project, 2, 'todo', 1);
    await reorderTask(project, 3, 'todo', 2);

    // Move task 2 out of todo
    await setTaskStatus(project, 2, 'in_progress');

    // Remaining todo tasks should be compacted to 0, 1
    const task1 = await getTaskByNumber(project, 1);
    const task3 = await getTaskByNumber(project, 3);
    expect(task1!.order).toBe(0);
    expect(task3!.order).toBe(1);
  });

  test('setTaskStatus does not change order for same-status update', async () => {
    const project = '/test/status-same';
    await createTask(project, 1, 'A', { status: 'in_progress' });
    await reorderTask(project, 1, 'in_progress', 0);

    const before = await getTaskByNumber(project, 1);
    const orderBefore = before!.order;

    // Set same status
    await setTaskStatus(project, 1, 'in_progress');

    const after = await getTaskByNumber(project, 1);
    expect(after!.order).toBe(orderBefore);
  });

  test('createTask with parentTaskNumber persists the relationship', async () => {
    const project = '/test/parent-task';
    await createTask(project, 1, 'Parent', { status: 'in_progress', branch: 'feat/parent' });
    const child = await createTask(project, 2, 'Child', {
      status: 'todo',
      parentTaskNumber: 1,
      mergeTarget: 'feat/parent',
    });

    expect(child.parentTaskNumber).toBe(1);
    expect(child.mergeTarget).toBe('feat/parent');

    const fetched = await getTaskByNumber(project, 2);
    expect(fetched!.parentTaskNumber).toBe(1);
  });

  test('createTask without parentTaskNumber leaves it undefined', async () => {
    const project = '/test/no-parent';
    const task = await createTask(project, 1, 'Standalone', { status: 'todo' });

    expect(task.parentTaskNumber).toBeUndefined();
  });

  test('parentTaskNumber is visible via getProjectTasks', async () => {
    const project = '/test/parent-in-list';
    await createTask(project, 1, 'Parent', { branch: 'feat/p' });
    await createTask(project, 2, 'Child', { status: 'todo', parentTaskNumber: 1 });

    const tasks = await getProjectTasks(project);
    const child = tasks.find((t) => t.taskNumber === 2);
    expect(child!.parentTaskNumber).toBe(1);
  });
});
