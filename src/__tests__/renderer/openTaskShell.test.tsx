import { describe, test, expect, beforeEach, vi } from 'vitest';

import { openTaskShell } from '../../components/navigation';
import { addProjectTerminal } from '../../components/terminal/terminalActions';
import { useProjectStore } from '../../stores/projectStore';
import { useUIStore } from '../../stores/uiStore';
import type { TaskWithWorkspace } from '../../types';

vi.mock('electron-log/renderer', () => ({
  default: { scope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// The spawn is the boundary: stubbed so what lands in the worktree is
// observable, and so jsdom never constructs an xterm.
vi.mock('../../components/terminal/terminalActions', () => ({
  addProjectTerminal: vi.fn().mockResolvedValue(true),
  reconnectOrphanedSessions: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../components/terminal/terminalReact', () => ({ terminalInstances: new Map() }));

const PROJECT = '/work/alpha';

const started: TaskWithWorkspace = {
  taskNumber: 4,
  name: 'Four',
  status: 'in_progress',
  createdAt: '2026-07-01T00:00:00.000Z',
  branch: 'task/4',
  worktreePath: '/work/alpha-4',
} as TaskWithWorkspace;

const neverStarted: TaskWithWorkspace = {
  taskNumber: 9,
  name: 'Nine',
  status: 'todo',
  createdAt: '2026-07-01T00:00:00.000Z',
} as TaskWithWorkspace;

/** Resolve the prompt the moment it is raised, as a user clicking the dialog would. */
function answerPrompt(action: 'recover' | null): Promise<void> {
  return new Promise((settled) => {
    const stop = useUIStore.subscribe((state) => {
      if (!state.missingWorktree) return;
      stop();
      state.missingWorktree.resolve(action);
      settled();
    });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(addProjectTerminal).mockResolvedValue(true);
  useUIStore.setState({ missingWorktree: null });
  useProjectStore.setState({ toasts: [] });
  window.api.task.checkWorktree = vi.fn().mockResolvedValue({ exists: true, branchExists: true });
  window.api.task.recover = vi.fn();
  window.api.task.start = vi.fn();
  window.api.task.getAll = vi.fn().mockResolvedValue([]);
});

describe('openTaskShell', () => {
  test('spawns into the existing worktree, resuming or not as asked', async () => {
    expect(await openTaskShell(PROJECT, started, { mode: 'resume' })).toBe(true);
    expect(addProjectTerminal).toHaveBeenCalledWith(
      PROJECT,
      undefined,
      expect.objectContaining({
        existingWorktree: expect.objectContaining({ path: '/work/alpha-4', branch: 'task/4' }),
        taskId: 4,
        skipAutoHook: false,
      }),
    );

    await openTaskShell(PROJECT, started, { mode: 'shell' });
    expect(addProjectTerminal).toHaveBeenLastCalledWith(
      PROJECT,
      undefined,
      expect.objectContaining({ skipAutoHook: true }),
    );
    expect(useUIStore.getState().missingWorktree).toBeNull();
  });

  test('recovers a worktree that is gone from disk, and spawns into the new path', async () => {
    window.api.task.checkWorktree = vi.fn().mockResolvedValue({ exists: false, branchExists: true });
    window.api.task.recover = vi.fn().mockResolvedValue({
      success: true,
      worktreePath: '/work/alpha-4-new',
      task: { branch: 'task/4' },
    });

    const answered = answerPrompt('recover');
    const opened = openTaskShell(PROJECT, started, { mode: 'shell' });
    await answered;

    expect(await opened).toBe(true);
    expect(window.api.task.recover).toHaveBeenCalledWith(PROJECT, 4);
    expect(addProjectTerminal).toHaveBeenCalledWith(
      PROJECT,
      undefined,
      expect.objectContaining({ existingWorktree: expect.objectContaining({ path: '/work/alpha-4-new' }) }),
    );
    // The prompt is cleared whichever way it went, or the next open would find
    // a stale request already on screen.
    expect(useUIStore.getState().missingWorktree).toBeNull();
  });

  test('declining recovery opens nothing and says nothing more', async () => {
    window.api.task.checkWorktree = vi.fn().mockResolvedValue({ exists: false, branchExists: true });

    const answered = answerPrompt(null);
    const opened = openTaskShell(PROJECT, started, { mode: 'shell' });
    await answered;

    expect(await opened).toBe(false);
    expect(addProjectTerminal).not.toHaveBeenCalled();
    expect(window.api.task.recover).not.toHaveBeenCalled();
    expect(useProjectStore.getState().toasts).toEqual([]);
    expect(useUIStore.getState().missingWorktree).toBeNull();
  });

  test('a task with no branch is started first, and lands as a plain shell', async () => {
    window.api.task.start = vi.fn().mockResolvedValue({
      success: true,
      worktreePath: '/work/alpha-9',
      task: { branch: 'task/9' },
    });

    expect(await openTaskShell(PROJECT, neverStarted, { mode: 'resume' })).toBe(true);
    expect(window.api.task.checkWorktree).not.toHaveBeenCalled();
    // 'resume' is overridden: a worktree created here has no session to resume.
    expect(addProjectTerminal).toHaveBeenCalledWith(
      PROJECT,
      undefined,
      expect.objectContaining({
        existingWorktree: expect.objectContaining({ path: '/work/alpha-9', branch: 'task/9' }),
        skipAutoHook: true,
      }),
    );
  });

  test('a failed start toasts and opens nothing', async () => {
    window.api.task.start = vi.fn().mockResolvedValue({ success: false, error: 'branch exists' });

    expect(await openTaskShell(PROJECT, neverStarted, { mode: 'shell' })).toBe(false);
    expect(addProjectTerminal).not.toHaveBeenCalled();
    expect(useProjectStore.getState().toasts[0]?.message).toBe('branch exists');
  });
});
