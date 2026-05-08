import { describe, test, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../stores/appStore';
import type { Project, TaskWithWorkspace } from '../../types';

function makeProject(path: string, name = path): Project {
  return {
    path,
    name,
    hasGit: true,
    hasClaude: false,
    lastModified: new Date('2026-01-01T00:00:00Z'),
  };
}

function makeTask(taskNumber: number, status: TaskWithWorkspace['status'], createdAt: string): TaskWithWorkspace {
  return {
    taskNumber,
    name: `Task ${taskNumber}`,
    status,
    order: taskNumber,
    createdAt,
  };
}

describe('appStore home-recents derivation', () => {
  beforeEach(() => {
    useAppStore.setState({ projects: [], taskCacheByProject: {}, homeRecents: null });
  });

  test('updateProjectTaskCache filters out done tasks and sorts by createdAt desc', () => {
    useAppStore.setState({ projects: [makeProject('/a')] });
    useAppStore
      .getState()
      .updateProjectTaskCache('/a', [
        makeTask(1, 'todo', '2026-01-01T00:00:00Z'),
        makeTask(2, 'done', '2026-01-05T00:00:00Z'),
        makeTask(3, 'in_progress', '2026-01-03T00:00:00Z'),
        makeTask(4, 'in_review', '2026-01-02T00:00:00Z'),
      ]);

    const recents = useAppStore.getState().homeRecents;
    expect(recents?.map((r) => r.taskNumber)).toEqual([3, 4, 1]);
  });

  test('caps homeRecents at 8 entries', () => {
    useAppStore.setState({ projects: [makeProject('/a')] });
    const tasks = Array.from({ length: 12 }, (_, i) =>
      // Newer tasks first by createdAt — task 12 is newest, task 1 oldest.
      makeTask(i + 1, 'todo', `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`),
    );
    useAppStore.getState().updateProjectTaskCache('/a', tasks);

    const recents = useAppStore.getState().homeRecents;
    expect(recents).toHaveLength(8);
    expect(recents?.map((r) => r.taskNumber)).toEqual([12, 11, 10, 9, 8, 7, 6, 5]);
  });

  test('skips cache entries for projects no longer in projects list', () => {
    useAppStore.setState({ projects: [makeProject('/a')] });
    useAppStore.getState().updateProjectTaskCache('/a', [makeTask(1, 'todo', '2026-01-01T00:00:00Z')]);
    useAppStore.getState().updateProjectTaskCache('/removed', [makeTask(99, 'todo', '2026-02-01T00:00:00Z')]);

    const recents = useAppStore.getState().homeRecents;
    expect(recents?.map((r) => r.taskNumber)).toEqual([1]);
  });

  test('updating one project does not clobber another project’s tasks', () => {
    useAppStore.setState({ projects: [makeProject('/a'), makeProject('/b')] });
    const store = useAppStore.getState();
    store.updateProjectTaskCache('/a', [makeTask(1, 'todo', '2026-01-01T00:00:00Z')]);
    store.updateProjectTaskCache('/b', [makeTask(2, 'todo', '2026-01-02T00:00:00Z')]);
    // Re-update /a — /b's contribution must remain.
    store.updateProjectTaskCache('/a', [makeTask(3, 'in_progress', '2026-01-03T00:00:00Z')]);

    const recents = useAppStore.getState().homeRecents ?? [];
    const numbers = recents.map((r) => r.taskNumber).sort();
    expect(numbers).toEqual([2, 3]);
  });

  test('homeRecents entries carry their project reference', () => {
    const projA = makeProject('/a', 'Alpha');
    const projB = makeProject('/b', 'Bravo');
    useAppStore.setState({ projects: [projA, projB] });
    useAppStore.getState().updateProjectTaskCache('/a', [makeTask(1, 'todo', '2026-01-01T00:00:00Z')]);
    useAppStore.getState().updateProjectTaskCache('/b', [makeTask(2, 'todo', '2026-01-02T00:00:00Z')]);

    const recents = useAppStore.getState().homeRecents ?? [];
    const byNumber = new Map(recents.map((r) => [r.taskNumber, r.project.name]));
    expect(byNumber.get(1)).toBe('Alpha');
    expect(byNumber.get(2)).toBe('Bravo');
  });
});
