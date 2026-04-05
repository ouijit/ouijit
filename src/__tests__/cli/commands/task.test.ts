import { describe, test, expect, vi, beforeEach } from 'vitest';
import { _resetCacheForTesting, getProjectTasks, getTaskByNumber, addProject, saveHook, createTask } from '../../../db';
import { handleTaskCommand } from '../../../cli/commands/task';

// Capture stdout output
function captureOutput() {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((data) => {
    chunks.push(typeof data === 'string' ? data : data.toString());
    return true;
  });
  return {
    spy,
    getJson: () => {
      spy.mockRestore();
      return JSON.parse(chunks.join(''));
    },
  };
}

const PROJECT = '/test/project';

describe('task commands', () => {
  beforeEach(async () => {
    _resetCacheForTesting();
    await addProject(PROJECT);
  });

  test('list returns empty array for new project', async () => {
    const output = captureOutput();
    await handleTaskCommand('list', [], {}, () => PROJECT);
    const result = output.getJson();
    expect(result).toEqual([]);
  });

  test('create creates a task in DB', async () => {
    const output = captureOutput();
    await handleTaskCommand('create', [], { name: 'Test task', prompt: 'Do stuff' }, () => PROJECT);
    const result = output.getJson();
    expect(result.success).toBe(true);
    expect(result.task.name).toBe('Test task');

    // Verify task is in DB
    const tasks = await getProjectTasks(PROJECT);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].name).toBe('Test task');
  });

  test('get retrieves a task by number', async () => {
    await createTask(PROJECT, 1, 'My task');
    const output = captureOutput();
    await handleTaskCommand('get', ['1'], {}, () => PROJECT);
    const result = output.getJson();
    expect(result.taskNumber).toBe(1);
    expect(result.name).toBe('My task');
  });

  test('list shows created tasks', async () => {
    await createTask(PROJECT, 1, 'Task A');
    await createTask(PROJECT, 2, 'Task B');

    const output = captureOutput();
    await handleTaskCommand('list', [], {}, () => PROJECT);
    const result = output.getJson();
    expect(result).toHaveLength(2);
    expect(result.map((t: { name: string }) => t.name)).toEqual(['Task A', 'Task B']);
  });

  test('set-status updates task status', async () => {
    await createTask(PROJECT, 1, 'Task', { status: 'todo' });
    const output = captureOutput();
    await handleTaskCommand('set-status', ['1', 'in_progress'], {}, () => PROJECT);
    const result = output.getJson();
    expect(result.success).toBe(true);

    const task = await getTaskByNumber(PROJECT, 1);
    expect(task?.status).toBe('in_progress');
  });

  test('set-name updates task name', async () => {
    await createTask(PROJECT, 1, 'Old name');
    const output = captureOutput();
    await handleTaskCommand('set-name', ['1', 'New', 'name'], {}, () => PROJECT);
    const result = output.getJson();
    expect(result.success).toBe(true);

    const task = await getTaskByNumber(PROJECT, 1);
    expect(task?.name).toBe('New name');
  });

  test('delete removes task from DB', async () => {
    await createTask(PROJECT, 1, 'Doomed');
    const output = captureOutput();
    await handleTaskCommand('delete', ['1'], {}, () => PROJECT);
    const result = output.getJson();
    expect(result.success).toBe(true);

    const task = await getTaskByNumber(PROJECT, 1);
    expect(task).toBeNull();
  });
});
