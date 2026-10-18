import { describe, test, expect, beforeEach, vi } from 'vitest';
import { useProjectStore } from '../../stores/projectStore';
import { useAppStore } from '../../stores/appStore';
import {
  deleteHook,
  getProjectConfig,
  getProjectTasks,
  loadProjectConfig,
  loadTasks,
  moveTask,
  refreshProjectData,
  saveHook,
  useProjectDataStore,
} from '../../stores/projectDataStore';
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

function column(projectPath: string, status: string): number[] {
  return getProjectTasks(projectPath)
    .filter((t) => t.status === status)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((t) => t.taskNumber);
}

beforeEach(() => {
  useProjectStore.setState({ toasts: [] });
  useProjectDataStore.setState({ configByProject: {}, scriptsByProject: {} });
  useAppStore.setState({
    projects: [
      { path: '/a', name: 'a' },
      { path: '/b', name: 'b' },
    ],
    taskCacheByProject: {},
    homeRecents: null,
  });
  vi.mocked(window.api.task.reorder).mockResolvedValue({ success: true });
});

describe('project tasks', () => {
  test('each project keeps its own tasks, and a late load is overtaken by a later one for the same project', async () => {
    let resolveStale!: (tasks: TaskWithWorkspace[]) => void;
    vi.mocked(window.api.task.getAll)
      .mockImplementationOnce(() => new Promise((res) => (resolveStale = res)))
      .mockResolvedValueOnce([makeTask(2, 'todo', 0)])
      .mockResolvedValueOnce([makeTask(9, 'in_progress', 0)]);

    const stale = loadTasks('/a');
    await loadTasks('/a');
    await loadTasks('/b');
    resolveStale([makeTask(1, 'todo', 0)]);
    await stale;

    expect(column('/a', 'todo')).toEqual([2]);
    expect(column('/b', 'in_progress')).toEqual([9]);
    expect(useAppStore.getState().homeRecents?.map((r) => [r.project.path, r.taskNumber])).toEqual(
      expect.arrayContaining([
        ['/a', 2],
        ['/b', 9],
      ]),
    );

    // A CLI change to a project nobody is looking at still reaches it.
    vi.mocked(window.api.task.getAll).mockResolvedValueOnce([makeTask(9, 'done', 0)]);
    refreshProjectData('/b', 'tasks');
    await vi.waitFor(() => expect(column('/b', 'done')).toEqual([9]));
  });

  test('moving a task reorders its column at once, and rolls back when the write fails', async () => {
    useAppStore
      .getState()
      .updateProjectTaskCache('/a', [makeTask(1, 'todo', 0), makeTask(2, 'todo', 1), makeTask(3, 'in_progress', 0)]);

    const move = moveTask('/a', 1, 'in_progress', 1);
    expect(column('/a', 'in_progress')).toEqual([3, 1]);
    expect(column('/a', 'todo')).toEqual([2]);
    await move;

    await moveTask('/a', 2, 'todo', 0);
    vi.mocked(window.api.task.reorder).mockResolvedValueOnce({ success: false });
    await moveTask('/a', 2, 'in_progress', 0);
    expect(column('/a', 'todo')).toEqual([2]);
    expect(column('/a', 'in_progress')).toEqual([3, 1]);
    expect(useProjectStore.getState().toasts.map((t) => t.message)).toContain('Failed to move task');
  });
});

describe('project config', () => {
  test('is loaded per project, keeps what it had when a load fails, and reflects a saved or deleted hook', async () => {
    const statuses = [
      { providerId: 'nono' as const, available: true },
      { providerId: 'custom' as const, available: false, detail: 'Set a sandbox command to use it.' },
    ];
    const editor = { id: 'e', type: 'editor' as const, name: 'edit', command: 'code' };
    vi.mocked(window.api.sandbox.status).mockResolvedValueOnce(statuses).mockResolvedValueOnce([]);
    vi.mocked(window.api.hooks.get).mockResolvedValueOnce({ editor }).mockResolvedValueOnce({});
    vi.mocked(window.api.globalSettings.get).mockImplementation(async (key) =>
      key === 'runnerSandbox:/a' ? 'nono' : undefined,
    );

    await loadProjectConfig('/a');
    await loadProjectConfig('/b');
    expect(getProjectConfig('/a')).toEqual({
      sandboxStatuses: statuses,
      availableSandboxProviders: ['nono'],
      hooks: { editor },
      runnerSandbox: 'nono',
    });
    expect(getProjectConfig('/b')).toMatchObject({ availableSandboxProviders: [], hooks: {}, runnerSandbox: 'none' });

    vi.mocked(window.api.sandbox.status).mockRejectedValueOnce(new Error('boom'));
    await loadProjectConfig('/a');
    expect(getProjectConfig('/a')?.hooks).toEqual({ editor });

    const run = { id: 'r', type: 'run' as const, name: 'Run', command: 'npm run dev' };
    vi.mocked(window.api.hooks.save).mockResolvedValueOnce({ success: true });
    await saveHook('/b', run);
    vi.mocked(window.api.hooks.save).mockResolvedValueOnce({ success: false });
    await saveHook('/b', { ...run, command: 'make dev' });
    expect(getProjectConfig('/b')?.hooks).toEqual({ run });
    expect(getProjectConfig('/a')?.hooks).toEqual({ editor });

    await deleteHook('/b', 'run');
    expect(getProjectConfig('/b')?.hooks).toEqual({});
    expect(window.api.hooks.delete).toHaveBeenCalledWith('/b', 'run');
  });
});
