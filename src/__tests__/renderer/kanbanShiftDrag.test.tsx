import { describe, test, expect, beforeEach, vi } from 'vitest';

vi.mock('electron-log/renderer', () => ({
  default: { scope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('../../components/terminal/terminalActions', () => ({
  addProjectTerminal: vi.fn().mockResolvedValue(true),
  closeProjectTerminal: vi.fn(),
}));

import { useProjectStore } from '../../stores/projectStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { completeTask } from '../../services/taskCompletion';
import { addProjectTerminal } from '../../components/terminal/terminalActions';
import type { TaskWithWorkspace } from '../../types';

const PROJECT = '/project';

function makeTask(): TaskWithWorkspace {
  return {
    taskNumber: 9,
    name: 'Ship done UX',
    status: 'in_review',
    order: 0,
    createdAt: '2026-01-01T00:00:00Z',
    worktreePath: '/wt/T-9',
    branch: 'ship-done-ux-9',
  };
}

describe('shift-drag (skip done hook)', () => {
  beforeEach(() => {
    useProjectStore.getState().resetForProject();
    useTerminalStore.setState({ terminalsByProject: {}, displayStates: {}, activeIndices: {} });
    vi.clearAllMocks();
    vi.mocked(window.api.hooks.get).mockResolvedValue({
      done: { command: 'echo cleanup', name: 'Done', source: 'configured', priority: 0 },
    });
    vi.mocked(window.api.task.setStatus).mockResolvedValue({ success: true });
    vi.mocked(window.api.task.getAll).mockResolvedValue([]);
  });

  test('shift-drag (hookControl skip) bypasses the configured done hook with no dialog', async () => {
    // This is what the KanbanBoard drag-end passes when shiftKeyHeld is true.
    const promptSpy = vi.spyOn(useProjectStore.getState(), 'requestRunHook');

    await completeTask({ projectPath: PROJECT, task: makeTask(), hookControl: { mode: 'skip' } });

    expect(promptSpy).not.toHaveBeenCalled();
    expect(addProjectTerminal).not.toHaveBeenCalled();
    expect(window.api.task.setStatus).toHaveBeenCalledWith(PROJECT, 9, 'done');
  });

  test('plain drop (no hookControl) shows the Done dialog instead of auto-running', async () => {
    // Sanity counterpart: no shift held -> the Done dialog is shown, exactly
    // like every other column transition.
    const promptSpy = vi
      .spyOn(useProjectStore.getState(), 'requestRunHook')
      .mockResolvedValue({ command: 'echo cleanup', sandboxed: false, foreground: false });

    await completeTask({ projectPath: PROJECT, task: makeTask() });

    expect(promptSpy).toHaveBeenCalledWith(expect.objectContaining({ hookType: 'done' }));
    expect(vi.mocked(addProjectTerminal).mock.calls[0][1]).toMatchObject({ command: 'echo cleanup' });
  });

  test('shiftKeyHeld is independently tracked in the project store', () => {
    expect(useProjectStore.getState().shiftKeyHeld).toBe(false);
    useProjectStore.setState({ shiftKeyHeld: true });
    expect(useProjectStore.getState().shiftKeyHeld).toBe(true);
    useProjectStore.getState().resetForProject();
    expect(useProjectStore.getState().shiftKeyHeld).toBe(false);
  });
});
