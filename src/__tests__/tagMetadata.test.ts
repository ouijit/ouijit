import { describe, test, expect } from 'vitest';
import {
  createTask,
  getAllTags,
  getTaskTags,
  addTagToTask,
  removeTagFromTask,
  setTaskTags,
  deleteTaskByNumber,
} from '../db';

describe('tagMetadata', () => {
  test('addTagToTask creates tag and associates with task', async () => {
    const project = '/test/tag-add';
    await createTask(project, 1, 'Tagged task');

    const tag = await addTagToTask(project, 1, 'monitoring');
    expect(tag.name).toBe('monitoring');
    expect(tag.id).toBeGreaterThan(0);

    const tags = await getTaskTags(project, 1);
    expect(tags).toHaveLength(1);
    expect(tags[0].name).toBe('monitoring');
  });

  test('addTagToTask is idempotent', async () => {
    const project = '/test/tag-idempotent';
    await createTask(project, 1, 'Task');

    await addTagToTask(project, 1, 'deploy');
    await addTagToTask(project, 1, 'deploy');

    const tags = await getTaskTags(project, 1);
    expect(tags).toHaveLength(1);
  });

  test('tags are case-insensitive', async () => {
    const project = '/test/tag-case';
    await createTask(project, 1, 'Task');

    const tag1 = await addTagToTask(project, 1, 'Deploy');
    const tag2 = await addTagToTask(project, 1, 'deploy');

    // Same tag, different case
    expect(tag1.id).toBe(tag2.id);

    const tags = await getTaskTags(project, 1);
    expect(tags).toHaveLength(1);
  });

  test('removeTagFromTask removes the association', async () => {
    const project = '/test/tag-remove';
    await createTask(project, 1, 'Task');

    await addTagToTask(project, 1, 'temp');
    await removeTagFromTask(project, 1, 'temp');

    const tags = await getTaskTags(project, 1);
    expect(tags).toHaveLength(0);
  });

  test('removeTagFromTask is case-insensitive', async () => {
    const project = '/test/tag-remove-case';
    await createTask(project, 1, 'Task');

    await addTagToTask(project, 1, 'Favorite');
    await removeTagFromTask(project, 1, 'FAVORITE');

    const tags = await getTaskTags(project, 1);
    expect(tags).toHaveLength(0);
  });

  test('setTaskTags replaces all tags', async () => {
    const project = '/test/tag-set';
    await createTask(project, 1, 'Task');

    await addTagToTask(project, 1, 'old-tag');
    const result = await setTaskTags(project, 1, ['new-tag-a', 'new-tag-b']);

    expect(result).toHaveLength(2);
    expect(result.map((t) => t.name).sort()).toEqual(['new-tag-a', 'new-tag-b']);

    const tags = await getTaskTags(project, 1);
    expect(tags).toHaveLength(2);
    expect(tags.map((t) => t.name).sort()).toEqual(['new-tag-a', 'new-tag-b']);
  });

  test('setTaskTags with empty array clears all tags', async () => {
    const project = '/test/tag-set-empty';
    await createTask(project, 1, 'Task');

    await addTagToTask(project, 1, 'will-be-gone');
    await setTaskTags(project, 1, []);

    const tags = await getTaskTags(project, 1);
    expect(tags).toHaveLength(0);
  });

  test('getAllTags returns all known tags', async () => {
    const project = '/test/tag-all';
    await createTask(project, 1, 'Task A');
    await createTask(project, 2, 'Task B');

    await addTagToTask(project, 1, 'alpha');
    await addTagToTask(project, 2, 'beta');

    const allTags = await getAllTags();
    const names = allTags.map((t) => t.name);
    expect(names).toContain('alpha');
    expect(names).toContain('beta');
  });

  test('tags shared across projects', async () => {
    const projectA = '/test/tag-cross-a';
    const projectB = '/test/tag-cross-b';
    await createTask(projectA, 1, 'Task A');
    await createTask(projectB, 1, 'Task B');

    const tagA = await addTagToTask(projectA, 1, 'shared');
    const tagB = await addTagToTask(projectB, 1, 'shared');

    // Same tag row (global tags)
    expect(tagA.id).toBe(tagB.id);

    // Each task has the tag
    const tagsA = await getTaskTags(projectA, 1);
    const tagsB = await getTaskTags(projectB, 1);
    expect(tagsA).toHaveLength(1);
    expect(tagsB).toHaveLength(1);
  });

  test('cascade delete removes task_tags when task is deleted', async () => {
    const project = '/test/tag-cascade';
    await createTask(project, 1, 'Doomed task');
    await addTagToTask(project, 1, 'ephemeral');

    await deleteTaskByNumber(project, 1);

    // Tag association is gone
    const tags = await getTaskTags(project, 1);
    expect(tags).toHaveLength(0);

    // The tag itself still exists (orphaned)
    const allTags = await getAllTags();
    expect(allTags.some((t) => t.name === 'ephemeral')).toBe(true);
  });

  test('pruneOrphans removes tags with no task associations', async () => {
    const project = '/test/tag-prune';
    await createTask(project, 1, 'Task');
    await addTagToTask(project, 1, 'orphan-tag');
    await deleteTaskByNumber(project, 1);

    // Import the repos function to access tagRepo directly
    const { _resetCacheForTesting } = await import('../db');
    // We need direct access to pruneOrphans — call via db barrel
    // Since pruneOrphans isn't exposed as async wrapper, test via tagRepo directly
    const { getDatabase } = await import('../db/database');
    const { TagRepo } = await import('../db/repos/tagRepo');
    const tagRepo = new TagRepo(getDatabase());

    const pruned = tagRepo.pruneOrphans();
    expect(pruned).toBeGreaterThanOrEqual(1);

    const allTags = await getAllTags();
    expect(allTags.some((t) => t.name === 'orphan-tag')).toBe(false);
  });

  test('getTaskTags returns empty for non-existent task', async () => {
    const tags = await getTaskTags('/test/tag-nonexistent', 999);
    expect(tags).toHaveLength(0);
  });

  test('addTagToTask throws for non-existent task', async () => {
    await expect(addTagToTask('/test/tag-no-task', 999, 'nope')).rejects.toThrow('Task not found');
  });

  test('multiple tags on same task', async () => {
    const project = '/test/tag-multi';
    await createTask(project, 1, 'Multi-tag task');

    await addTagToTask(project, 1, 'frontend');
    await addTagToTask(project, 1, 'monitoring');
    await addTagToTask(project, 1, 'deploy');

    const tags = await getTaskTags(project, 1);
    expect(tags).toHaveLength(3);
    // Sorted by name
    expect(tags.map((t) => t.name)).toEqual(['deploy', 'frontend', 'monitoring']);
  });
});
