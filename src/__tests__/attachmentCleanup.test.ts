import { describe, test, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import { createTask, getTaskByNumber } from '../db';
import { saveAttachment } from '../attachments';
import { trashTaskWithWorktree, updateTaskDescription } from '../taskLifecycle';

const PROJECT = '/test/attachment-cleanup';

async function makeAttachment(): Promise<string> {
  const result = await saveAttachment(new Uint8Array([1, 2, 3]), 'png');
  expect(result.success).toBe(true);
  return result.path!;
}

describe('attachment cleanup', () => {
  beforeEach(async () => {
    await createTask(PROJECT, 1, 'first');
    await createTask(PROJECT, 2, 'second');
  });

  test('updateTaskDescription removes attachment files dropped by the edit', async () => {
    const filePath = await makeAttachment();
    await updateTaskDescription(PROJECT, 1, `here ![](${filePath}) end`);

    await updateTaskDescription(PROJECT, 1, 'just text now');

    const stored = await getTaskByNumber(PROJECT, 1);
    expect(stored?.prompt).toBe('just text now');
    expect(fs.existsSync(filePath)).toBe(false);
  });

  test('updateTaskDescription keeps a file still referenced by another task', async () => {
    const shared = await makeAttachment();
    await updateTaskDescription(PROJECT, 1, `mine ![](${shared})`);
    await updateTaskDescription(PROJECT, 2, `also mine ![](${shared})`);

    await updateTaskDescription(PROJECT, 1, 'no more image');

    expect(fs.existsSync(shared)).toBe(true);
  });

  test('updateTaskDescription preserves files still referenced by the same task', async () => {
    const kept = await makeAttachment();
    const dropped = await makeAttachment();
    await updateTaskDescription(PROJECT, 1, `keep ![](${kept}) drop ![](${dropped})`);

    await updateTaskDescription(PROJECT, 1, `keep ![](${kept})`);

    expect(fs.existsSync(kept)).toBe(true);
    expect(fs.existsSync(dropped)).toBe(false);
  });

  test('trashTaskWithWorktree removes the task’s attachments', async () => {
    const filePath = await makeAttachment();
    await updateTaskDescription(PROJECT, 1, `with ![](${filePath})`);

    const result = await trashTaskWithWorktree(PROJECT, 1);

    expect(result.success).toBe(true);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  test('trashTaskWithWorktree keeps attachments still referenced by other tasks', async () => {
    const shared = await makeAttachment();
    await updateTaskDescription(PROJECT, 1, `mine ![](${shared})`);
    await updateTaskDescription(PROJECT, 2, `mine too ![](${shared})`);

    await trashTaskWithWorktree(PROJECT, 1);

    expect(fs.existsSync(shared)).toBe(true);
  });
});
