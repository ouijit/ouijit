import { describe, test, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { app } from 'electron';
import { getProjectTasks, _resetCacheForTesting } from '../taskMetadata';

const METADATA_FILE = 'task-metadata.json';

function getMetadataPath(): string {
  return path.join(app.getPath('userData'), METADATA_FILE);
}

function writeV1Store(data: Record<string, unknown>): void {
  fs.writeFileSync(getMetadataPath(), JSON.stringify(data, null, 2), 'utf-8');
}

describe('schema migration v1 → v2', () => {
  beforeEach(() => {
    _resetCacheForTesting();
    try { fs.unlinkSync(getMetadataPath()); } catch { /* ignore */ }
  });

  test('migrates open tasks to in_progress', async () => {
    writeV1Store({
      '/project': {
        nextTaskNumber: 2,
        tasks: [{ taskNumber: 1, branch: 'feat/a', name: 'Task A', status: 'open', createdAt: '2024-01-01T00:00:00.000Z' }],
      },
    });

    const tasks = await getProjectTasks('/project');
    expect(tasks[0].status).toBe('in_progress');
  });

  test('migrates open+readyToShip to in_review', async () => {
    writeV1Store({
      '/project': {
        nextTaskNumber: 2,
        tasks: [{
          taskNumber: 1, branch: 'feat/b', name: 'Task B',
          status: 'open', readyToShip: true, createdAt: '2024-01-01T00:00:00.000Z',
        }],
      },
    });

    const tasks = await getProjectTasks('/project');
    expect(tasks[0].status).toBe('in_review');
    expect((tasks[0] as unknown as Record<string, unknown>).readyToShip).toBeUndefined();
  });

  test('migrates closed to done', async () => {
    writeV1Store({
      '/project': {
        nextTaskNumber: 2,
        tasks: [{
          taskNumber: 1, branch: 'feat/c', name: 'Task C',
          status: 'closed', closedAt: '2024-06-15T12:00:00.000Z', createdAt: '2024-01-01T00:00:00.000Z',
        }],
      },
    });

    const tasks = await getProjectTasks('/project');
    expect(tasks[0].status).toBe('done');
    expect(tasks[0].closedAt).toBe('2024-06-15T12:00:00.000Z');
  });

  test('migration is idempotent', async () => {
    writeV1Store({
      '/project': {
        nextTaskNumber: 2,
        tasks: [{ taskNumber: 1, branch: 'feat/d', name: 'Task D', status: 'open', createdAt: '2024-01-01T00:00:00.000Z' }],
      },
    });

    const tasks1 = await getProjectTasks('/project');
    expect(tasks1[0].status).toBe('in_progress');

    // Clear cache, reload from disk (which was saved after migration)
    _resetCacheForTesting();
    const tasks2 = await getProjectTasks('/project');
    expect(tasks2[0].status).toBe('in_progress');

    // Verify no double-migration artifacts
    const onDisk = JSON.parse(fs.readFileSync(getMetadataPath(), 'utf-8'));
    expect(onDisk.__schemaVersion).toBe(2);
    expect(onDisk['/project'].tasks[0].status).toBe('in_progress');
    expect(onDisk['/project'].tasks[0].readyToShip).toBeUndefined();
  });

  test('sets schemaVersion on migrated store', async () => {
    writeV1Store({
      '/project': {
        nextTaskNumber: 1,
        tasks: [],
      },
    });

    await getProjectTasks('/project');

    const onDisk = JSON.parse(fs.readFileSync(getMetadataPath(), 'utf-8'));
    expect(onDisk.__schemaVersion).toBe(2);
  });
});
