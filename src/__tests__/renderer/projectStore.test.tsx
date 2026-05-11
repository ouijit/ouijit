import { describe, test, expect, beforeEach, vi } from 'vitest';
import { useProjectStore } from '../../stores/projectStore';
import { useAppStore } from '../../stores/appStore';
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

describe('projectStore.moveTask', () => {
  beforeEach(() => {
    useProjectStore.setState({ tasks: [], _version: 0, toasts: [] });
    vi.mocked(window.api.task.reorder).mockResolvedValue({ success: true });
  });

  test('optimistic update sets order fields matching new positions', async () => {
    const tasks = [makeTask(1, 'todo', 0), makeTask(2, 'todo', 1), makeTask(3, 'in_progress', 0)];
    useProjectStore.setState({ tasks });

    // Move task 1 from todo to in_progress at index 1 (after task 3)
    const promise = useProjectStore.getState().moveTask('/project', 1, 'in_progress', 1);

    // Check optimistic state before the API resolves
    const updated = useProjectStore.getState().tasks;
    const inProgress = updated.filter((t) => t.status === 'in_progress');
    inProgress.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    expect(inProgress).toHaveLength(2);
    expect(inProgress[0].taskNumber).toBe(3);
    expect(inProgress[0].order).toBe(0);
    expect(inProgress[1].taskNumber).toBe(1);
    expect(inProgress[1].order).toBe(1);

    await promise;
  });

  test('optimistic reorder within the same column updates order fields', async () => {
    const tasks = [makeTask(1, 'todo', 0), makeTask(2, 'todo', 1), makeTask(3, 'todo', 2)];
    useProjectStore.setState({ tasks });

    // Move task 1 to index 2 (end of todo column)
    const promise = useProjectStore.getState().moveTask('/project', 1, 'todo', 2);

    const updated = useProjectStore.getState().tasks;
    const todo = updated.filter((t) => t.status === 'todo');
    todo.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    expect(todo.map((t) => t.taskNumber)).toEqual([2, 3, 1]);
    expect(todo.map((t) => t.order)).toEqual([0, 1, 2]);

    await promise;
  });

  test('rolls back on API failure', async () => {
    vi.mocked(window.api.task.reorder).mockResolvedValue({ success: false });

    const tasks = [makeTask(1, 'todo', 0), makeTask(2, 'in_progress', 0)];
    useProjectStore.setState({ tasks });

    await useProjectStore.getState().moveTask('/project', 1, 'in_progress', 0);

    const rolled = useProjectStore.getState().tasks;
    expect(rolled).toEqual(tasks);
  });
});

describe('projectStore.loadTasks → appStore cache', () => {
  beforeEach(() => {
    useProjectStore.setState({ tasks: [], _version: 0, toasts: [] });
    useAppStore.setState({
      projects: [
        {
          path: '/project',
          name: 'project',
          hasGit: true,
          hasClaude: false,
          lastModified: new Date('2026-01-01T00:00:00Z'),
        },
      ],
      taskCacheByProject: {},
      homeRecents: null,
    });
  });

  test('writes loaded tasks through to appStore.taskCacheByProject', async () => {
    const tasks = [makeTask(1, 'todo', 0), makeTask(2, 'in_progress', 1)];
    vi.mocked(window.api.task.getAll).mockResolvedValue(tasks);

    await useProjectStore.getState().loadTasks('/project');

    expect(useAppStore.getState().taskCacheByProject['/project']).toEqual(tasks);
    expect(
      useAppStore
        .getState()
        .homeRecents?.map((r) => r.taskNumber)
        .sort(),
    ).toEqual([1, 2]);
  });
});

describe('projectStore.pendingCliStarts (T-366)', () => {
  beforeEach(() => {
    useProjectStore.setState({ pendingCliStarts: {} });
  });

  const start = (n: number) => ({
    taskNumber: n,
    worktreePath: `/wt/T-${n}`,
    branch: `b-${n}`,
    createdAt: '2026-05-10T00:00:00.000Z',
    sandboxed: false,
  });

  test('enqueueCliStart appends per project', () => {
    useProjectStore.getState().enqueueCliStart('/a', start(1));
    useProjectStore.getState().enqueueCliStart('/a', start(2));
    useProjectStore.getState().enqueueCliStart('/b', start(3));

    const queue = useProjectStore.getState().pendingCliStarts;
    expect(queue['/a'].map((s) => s.taskNumber)).toEqual([1, 2]);
    expect(queue['/b'].map((s) => s.taskNumber)).toEqual([3]);
  });

  test('enqueueCliStart dedupes by taskNumber', () => {
    useProjectStore.getState().enqueueCliStart('/a', start(1));
    useProjectStore.getState().enqueueCliStart('/a', start(1));
    expect(useProjectStore.getState().pendingCliStarts['/a']).toHaveLength(1);
  });

  test('drainCliStarts returns and clears the queue for a project', () => {
    useProjectStore.getState().enqueueCliStart('/a', start(1));
    useProjectStore.getState().enqueueCliStart('/a', start(2));
    useProjectStore.getState().enqueueCliStart('/b', start(3));

    const drained = useProjectStore.getState().drainCliStarts('/a');
    expect(drained.map((s) => s.taskNumber)).toEqual([1, 2]);
    expect(useProjectStore.getState().pendingCliStarts['/a']).toBeUndefined();
    expect(useProjectStore.getState().pendingCliStarts['/b']).toHaveLength(1);
  });

  test('drainCliStarts returns empty array when nothing is queued', () => {
    expect(useProjectStore.getState().drainCliStarts('/none')).toEqual([]);
  });
});

describe('projectStore.loadProjectConfig', () => {
  beforeEach(() => {
    useProjectStore.setState({
      sandboxAvailable: false,
      configuredHooks: {},
      configProjectPath: null,
    });
    vi.mocked(window.api.lima.status).mockReset();
    vi.mocked(window.api.hooks.get).mockReset();
  });

  test('writes sandbox availability + configured hooks into the store', async () => {
    vi.mocked(window.api.lima.status).mockResolvedValue({ available: true, vmStatus: 'Running' });
    vi.mocked(window.api.hooks.get).mockResolvedValue({
      editor: { name: 'edit', command: 'code' },
      run: undefined,
    });

    await useProjectStore.getState().loadProjectConfig('/a');

    const s = useProjectStore.getState();
    expect(s.sandboxAvailable).toBe(true);
    expect(s.configuredHooks).toEqual({ editor: true });
    expect(s.configProjectPath).toBe('/a');
  });

  test('the most-recent load wins regardless of IPC resolve order (stale-load race)', async () => {
    // load(A) hangs longer than load(B); we expect B's state to land, not A's.
    let resolveA!: (v: { available: boolean; vmStatus: string }) => void;
    const aStatus = new Promise<{ available: boolean; vmStatus: string }>((res) => {
      resolveA = res;
    });
    vi.mocked(window.api.lima.status).mockImplementationOnce(() => aStatus);
    vi.mocked(window.api.hooks.get).mockImplementationOnce(() =>
      Promise.resolve({ editor: { name: 'a', command: 'a' } }),
    );

    vi.mocked(window.api.lima.status).mockResolvedValueOnce({ available: true, vmStatus: 'Running' });
    vi.mocked(window.api.hooks.get).mockResolvedValueOnce({ run: { name: 'b', command: 'b' } });

    const aPromise = useProjectStore.getState().loadProjectConfig('/a');
    const bPromise = useProjectStore.getState().loadProjectConfig('/b');

    // Resolve B first (it has mockResolvedValueOnce so it resolves immediately).
    await bPromise;
    expect(useProjectStore.getState().configProjectPath).toBe('/b');
    expect(useProjectStore.getState().configuredHooks).toEqual({ run: true });

    // Now let A resolve — its writes must be ignored.
    resolveA({ available: false, vmStatus: 'NotCreated' });
    await aPromise;

    const s = useProjectStore.getState();
    expect(s.configProjectPath).toBe('/b');
    expect(s.configuredHooks).toEqual({ run: true });
    expect(s.sandboxAvailable).toBe(true);
  });

  test('IPC failures are swallowed and leave the store untouched', async () => {
    useProjectStore.setState({ sandboxAvailable: true, configuredHooks: { editor: true }, configProjectPath: '/prev' });
    vi.mocked(window.api.lima.status).mockRejectedValueOnce(new Error('boom'));
    vi.mocked(window.api.hooks.get).mockResolvedValueOnce({});

    await useProjectStore.getState().loadProjectConfig('/a');

    const s = useProjectStore.getState();
    expect(s.sandboxAvailable).toBe(true);
    expect(s.configuredHooks).toEqual({ editor: true });
    expect(s.configProjectPath).toBe('/prev');
  });
});

describe('projectStore.markHookConfigured', () => {
  beforeEach(() => {
    useProjectStore.setState({ configuredHooks: {} });
  });

  test('adds the hook type to configuredHooks', () => {
    useProjectStore.getState().markHookConfigured('editor');
    expect(useProjectStore.getState().configuredHooks).toEqual({ editor: true });
  });

  test('is idempotent — repeating the call does not allocate a new object', () => {
    useProjectStore.getState().markHookConfigured('editor');
    const ref = useProjectStore.getState().configuredHooks;
    useProjectStore.getState().markHookConfigured('editor');
    // Same reference proves the early-return path was taken.
    expect(useProjectStore.getState().configuredHooks).toBe(ref);
  });
});
