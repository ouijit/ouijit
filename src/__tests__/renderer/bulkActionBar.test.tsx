import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';

vi.mock('electron-log/renderer', () => ({
  default: { scope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// The helper itself is covered in bulkTransitionTasks.test.tsx — this file
// only verifies that the bar's buttons dispatch to it with the right args.
vi.mock('../../services/taskStartService', () => ({
  bulkTransitionTasks: vi.fn().mockResolvedValue([]),
}));

import { useProjectStore } from '../../stores/projectStore';
import { BulkActionBar } from '../../components/kanban/BulkActionBar';
import { bulkTransitionTasks } from '../../services/taskStartService';
import type { TaskWithWorkspace } from '../../types';

const PROJECT = '/project';

function task(taskNumber: number, status: TaskWithWorkspace['status']): TaskWithWorkspace {
  return { taskNumber, name: `Task ${taskNumber}`, status, order: 0, createdAt: '2026-01-01T00:00:00Z' };
}

describe('BulkActionBar', () => {
  beforeEach(() => {
    useProjectStore.getState().resetForProject();
    vi.clearAllMocks();
  });

  test('clicking a status button dispatches the current selection to bulkTransitionTasks', () => {
    useProjectStore.setState({
      tasks: [task(1, 'todo'), task(2, 'todo')],
      selectedTaskNumbers: new Set([1, 2]),
    });

    render(<BulkActionBar projectPath={PROJECT} onOpenTerminal={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'In Progress' }));

    expect(bulkTransitionTasks).toHaveBeenCalledWith(PROJECT, expect.arrayContaining([1, 2]), 'in_progress');
  });

  test('hides the button for the status all selected tasks share', () => {
    useProjectStore.setState({
      tasks: [task(1, 'todo'), task(2, 'todo')],
      selectedTaskNumbers: new Set([1, 2]),
    });

    render(<BulkActionBar projectPath={PROJECT} onOpenTerminal={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'To Do' })).toBeNull();
    expect(screen.getByRole('button', { name: 'In Progress' })).toBeTruthy();
  });
});
