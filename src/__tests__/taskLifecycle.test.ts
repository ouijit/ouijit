import { describe, test, expect } from 'vitest';
import { createTask, getProjectTasks, getTaskByNumber, setTaskStatus, deleteTaskByNumber, reorderTask } from '../db';

describe('task lifecycle integration', () => {
  test('multi-task workflow: create, reorder, status transitions, delete', async () => {
    const project = '/test/lifecycle-integration';

    // 1. Create 3 todo tasks
    await createTask(project, 1, 'Design API', { status: 'todo' });
    await createTask(project, 2, 'Build frontend', { status: 'todo' });
    await createTask(project, 3, 'Write tests', { status: 'todo' });

    // 2. Verify ordering (0, 1, 2 in todo column)
    let tasks = await getProjectTasks(project);
    let todoTasks = tasks.filter((t) => t.status === 'todo');
    expect(todoTasks).toHaveLength(3);
    expect(todoTasks.map((t) => t.taskNumber)).toEqual([1, 2, 3]);
    expect(todoTasks.map((t) => t.order)).toEqual([0, 1, 2]);

    // 3. Start task 1 (→ in_progress)
    await setTaskStatus(project, 1, 'in_progress');
    let task1 = await getTaskByNumber(project, 1);
    expect(task1!.status).toBe('in_progress');

    // 4. Reorder: drag task 3 to top of todo
    await reorderTask(project, 3, 'todo', 0);
    tasks = await getProjectTasks(project);
    todoTasks = tasks.filter((t) => t.status === 'todo');
    expect(todoTasks.map((t) => t.taskNumber)).toEqual([3, 2]);

    // 5. Move task 2 to in_progress via status change
    await setTaskStatus(project, 2, 'in_progress');

    // 6. Verify both columns have correct content
    tasks = await getProjectTasks(project);
    todoTasks = tasks.filter((t) => t.status === 'todo');
    const ipTasks = tasks.filter((t) => t.status === 'in_progress');
    expect(todoTasks.map((t) => t.taskNumber)).toEqual([3]);
    expect(ipTasks.map((t) => t.taskNumber)).toEqual([1, 2]);

    // 7. Move task 1 to in_review
    await setTaskStatus(project, 1, 'in_review');
    task1 = await getTaskByNumber(project, 1);
    expect(task1!.status).toBe('in_review');

    // 8. Move task 1 to done — verify closedAt set
    await setTaskStatus(project, 1, 'done');
    task1 = await getTaskByNumber(project, 1);
    expect(task1!.status).toBe('done');
    expect(task1!.closedAt).toBeTruthy();

    // 9. Move task 1 back to in_progress — verify closedAt cleared
    await setTaskStatus(project, 1, 'in_progress');
    task1 = await getTaskByNumber(project, 1);
    expect(task1!.status).toBe('in_progress');
    expect(task1!.closedAt).toBeUndefined();

    // 10. Delete task 3
    const deleteResult = await deleteTaskByNumber(project, 3);
    expect(deleteResult.success).toBe(true);

    // 11. Verify remaining tasks and ordering intact
    tasks = await getProjectTasks(project);
    expect(tasks).toHaveLength(2);
    expect(tasks.map((t) => t.taskNumber).sort()).toEqual([1, 2]);

    // Both should be in_progress
    const remaining = tasks.filter((t) => t.status === 'in_progress');
    expect(remaining).toHaveLength(2);
  });
});
