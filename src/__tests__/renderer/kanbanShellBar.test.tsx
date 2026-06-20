/**
 * Behavior tests for the kanban shell bar. The kanban board only renders task
 * columns, so standalone interactive shells (terminals with taskId === null)
 * would otherwise be invisible while the board is up. The bar surfaces those
 * shells as chips and switches to them on click. Task terminals (taskId set)
 * and loading placeholders never appear in the bar.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { KanbanShellBar } from '../../components/kanban/KanbanShellBar';
import { useTerminalStore } from '../../stores/terminalStore';

const PROJECT = '/tmp/project';

function reset() {
  useTerminalStore.setState({ displayStates: {}, terminalsByProject: {}, activeIndices: {} });
}

describe('KanbanShellBar', () => {
  beforeEach(reset);

  it('renders nothing when there are no standalone shells', () => {
    useTerminalStore.getState().addTerminal(PROJECT, 'task-pty', { taskId: 1, label: 'Task work' });
    const { container } = render(<KanbanShellBar projectPath={PROJECT} onSwitchToTerminal={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('lists each standalone shell with its name and omits task terminals', () => {
    const store = useTerminalStore.getState();
    store.addTerminal(PROJECT, 'shell-1', { taskId: null, label: 'my-shell' });
    store.addTerminal(PROJECT, 'task-1', { taskId: 2, label: 'task-term' });
    store.addTerminal(PROJECT, 'shell-2', { taskId: null, label: 'fallback', lastOscTitle: 'npm run dev' });

    render(<KanbanShellBar projectPath={PROJECT} onSwitchToTerminal={vi.fn()} />);

    expect(screen.getByText('my-shell')).toBeTruthy();
    // OSC title wins over the label as the display name.
    expect(screen.getByText('npm run dev')).toBeTruthy();
    expect(screen.queryByText('task-term')).toBeNull();
  });

  it('excludes loading placeholders', () => {
    useTerminalStore.getState().addTerminal(PROJECT, 'loading', { taskId: null, label: 'pending', isLoading: true });
    const { container } = render(<KanbanShellBar projectPath={PROJECT} onSwitchToTerminal={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('switches to the shell when its chip is clicked', () => {
    useTerminalStore.getState().addTerminal(PROJECT, 'shell-1', { taskId: null, label: 'my-shell' });
    const onSwitch = vi.fn();

    render(<KanbanShellBar projectPath={PROJECT} onSwitchToTerminal={onSwitch} />);
    fireEvent.click(screen.getByText('my-shell'));

    expect(onSwitch).toHaveBeenCalledWith('shell-1');
  });

  it('marks sandboxed shells in the chip label', () => {
    useTerminalStore.getState().addTerminal(PROJECT, 'shell-1', { taskId: null, label: 'box', sandboxed: true });
    render(<KanbanShellBar projectPath={PROJECT} onSwitchToTerminal={vi.fn()} />);
    expect(screen.getByText(/\(sandbox\)/)).toBeTruthy();
  });
});
