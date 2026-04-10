import { describe, test, expect } from 'vitest';
import { createTask, getTaskByNumber } from '../db';
import { createBranchFromTask } from '../taskLifecycle';

describe('createBranchFromTask', () => {
  test('creates a child task with parentTaskNumber and mergeTarget', async () => {
    const project = '/test/branch-from';
    await createTask(project, 1, 'Parent', { branch: 'feat/parent', status: 'in_progress' });

    const result = await createBranchFromTask(project, 1, 'Child feature');
    expect(result.success).toBe(true);
    expect(result.task).toBeDefined();
    expect(result.task!.name).toBe('Child feature');
    expect(result.task!.status).toBe('todo');
    expect(result.task!.parentTaskNumber).toBe(1);
    expect(result.task!.mergeTarget).toBe('feat/parent');
  });

  test('returns error when parent task not found', async () => {
    const result = await createBranchFromTask('/test/missing-parent', 99, 'Orphan');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Parent task not found');
  });

  test('returns error when parent has no branch', async () => {
    const project = '/test/no-branch-parent';
    await createTask(project, 1, 'Unstarted parent', { status: 'todo' });

    const result = await createBranchFromTask(project, 1, 'Child');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Parent task has no branch');
  });

  test('assigns next sequential task number', async () => {
    const project = '/test/branch-from-counter';
    await createTask(project, 1, 'Parent', { branch: 'feat/parent', status: 'in_progress' });

    const result = await createBranchFromTask(project, 1, 'Child');
    expect(result.task!.taskNumber).toBe(2);
  });

  test('defaults name to Untitled when not provided', async () => {
    const project = '/test/branch-from-unnamed';
    await createTask(project, 1, 'Parent', { branch: 'feat/parent', status: 'in_progress' });

    const result = await createBranchFromTask(project, 1);
    expect(result.task!.name).toBe('Untitled');
  });
});
