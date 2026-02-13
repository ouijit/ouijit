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
  deleteTaskByNumber,
} from '../taskMetadata';

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

  test('getProjectTasks sorts by status then date', async () => {
    const project = '/test/sort-order';

    await createTask(project, 1, 'In progress old');
    await new Promise(r => setTimeout(r, 10));
    await createTask(project, 2, 'In progress new');
    await new Promise(r => setTimeout(r, 10));
    await createTask(project, 3, 'Done old');
    await setTaskStatus(project, 3, 'done');
    await new Promise(r => setTimeout(r, 10));
    await createTask(project, 4, 'Done new');
    await setTaskStatus(project, 4, 'done');

    const tasks = await getProjectTasks(project);
    expect(tasks).toHaveLength(4);

    // in_progress first (newest first)
    expect(tasks[0].name).toBe('In progress new');
    expect(tasks[1].name).toBe('In progress old');
    // Then done (newest first)
    expect(tasks[2].name).toBe('Done new');
    expect(tasks[3].name).toBe('Done old');
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

  test('createTask with todo status (no branch)', async () => {
    const project = '/test/todo-task';
    const task = await createTask(project, 1, 'Plan feature', { status: 'todo' });

    expect(task.status).toBe('todo');
    expect(task.branch).toBeUndefined();
  });
});
