/**
 * Smoke tests for the View/container split. These pure presentational
 * components are reused by the marketing site, so we lock in their public
 * prop shape with render-and-assert tests. Deeper behavior (drag, store
 * wiring) is tested through the smart wrappers elsewhere.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { KanbanCardView } from '../../components/kanban/KanbanCardView';
import { KanbanBadgeView } from '../../components/kanban/KanbanBadgeView';
import { KanbanColumnView } from '../../components/kanban/KanbanColumnView';
import { TerminalCardView } from '../../components/terminal/TerminalCardView';
import {
  TerminalHeaderView,
  TerminalHeaderName,
  TerminalHeaderTags,
} from '../../components/terminal/TerminalHeaderView';
import { HookRowView } from '../../components/scripts/HookRowView';
import { ScriptRowView } from '../../components/scripts/ScriptRowView';
import type { TaskWithWorkspace } from '../../types';

const baseTask: TaskWithWorkspace = {
  taskNumber: 7,
  name: 'Wire up the toaster',
  status: 'in_progress',
  branch: 'wire-up-toaster',
  worktreePath: '/tmp/T-7',
  createdAt: '2026-05-08T09:00:00Z',
};

describe('KanbanCardView', () => {
  it('renders task name', () => {
    render(<KanbanCardView task={baseTask} />);
    expect(screen.getByText('Wire up the toaster')).toBeTruthy();
  });

  it('renders a textarea when isRenamingTask is true', () => {
    const { container } = render(<KanbanCardView task={baseTask} isRenamingTask />);
    expect(container.querySelector('textarea')).toBeTruthy();
  });

  it('calls onStartRenameTask on name dblclick', () => {
    const onStart = vi.fn();
    render(<KanbanCardView task={baseTask} onStartRenameTask={onStart} />);
    fireEvent.doubleClick(screen.getByText('Wire up the toaster'));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('cancels rename on empty blur — prevents stuck rename UI', () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const { container } = render(
      <KanbanCardView task={baseTask} isRenamingTask onCommitRenameTask={onCommit} onCancelRenameTask={onCancel} />,
    );
    const textarea = container.querySelector('textarea')!;
    fireEvent.change(textarea, { target: { value: '   ' } });
    fireEvent.blur(textarea);
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('cancels rename on unchanged blur', () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const { container } = render(
      <KanbanCardView task={baseTask} isRenamingTask onCommitRenameTask={onCommit} onCancelRenameTask={onCancel} />,
    );
    const textarea = container.querySelector('textarea')!;
    fireEvent.change(textarea, { target: { value: baseTask.name } });
    fireEvent.blur(textarea);
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('commits a non-empty new name on blur', () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const { container } = render(
      <KanbanCardView task={baseTask} isRenamingTask onCommitRenameTask={onCommit} onCancelRenameTask={onCancel} />,
    );
    const textarea = container.querySelector('textarea')!;
    fireEvent.change(textarea, { target: { value: 'Renamed' } });
    fireEvent.blur(textarea);
    expect(onCommit).toHaveBeenCalledWith(7, 'Renamed');
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe('KanbanBadgeView', () => {
  it('renders the task number', () => {
    render(<KanbanBadgeView taskNumber={42} />);
    expect(screen.getByText('42')).toBeTruthy();
  });
});

describe('KanbanColumnView', () => {
  it('renders label, count, and children', () => {
    render(
      <KanbanColumnView status="todo" label="Todo" count={3}>
        <div data-testid="child" />
      </KanbanColumnView>,
    );
    expect(screen.getByText('Todo')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByTestId('child')).toBeTruthy();
  });
});

describe('TerminalCardView', () => {
  it('applies project-card--active class when active', () => {
    const { container } = render(<TerminalCardView isActive>body</TerminalCardView>);
    expect(container.querySelector('.project-card--active')).toBeTruthy();
  });

  it('omits the active class on back cards', () => {
    const { container } = render(<TerminalCardView backDepth={2}>body</TerminalCardView>);
    expect(container.querySelector('.project-card--active')).toBeNull();
  });
});

describe('TerminalHeaderView', () => {
  it('renders nameContent and tagsContent', () => {
    render(
      <TerminalHeaderView
        summaryType="ready"
        nameContent={<TerminalHeaderName label="claude" summary="thinking" />}
        tagsContent={<TerminalHeaderTags tags={['auth']} />}
      />,
    );
    expect(screen.getByText('claude')).toBeTruthy();
    // Em-dash separator should render literally, not as a backslash escape.
    expect(screen.getByText('— thinking')).toBeTruthy();
    expect(screen.getByText('auth')).toBeTruthy();
  });

  it('fires onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(
      <TerminalHeaderView
        summaryType="ready"
        nameContent={<TerminalHeaderName label="claude" />}
        showCloseButton
        onClose={onClose}
      />,
    );
    fireEvent.click(container.querySelector('button')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('HookRowView', () => {
  it('renders configure label when no command is set', () => {
    render(<HookRowView label="Start" description="When a task starts" />);
    expect(screen.getByText('+ Configure')).toBeTruthy();
  });

  it('renders edit label and command when configured', () => {
    render(<HookRowView label="Start" description="When a task starts" command="echo hi" />);
    expect(screen.getByText('Edit')).toBeTruthy();
    expect(screen.getByText('echo hi')).toBeTruthy();
  });
});

describe('ScriptRowView', () => {
  it('renders name and command', () => {
    render(<ScriptRowView name="dev" command="npm run dev" />);
    expect(screen.getByText('dev')).toBeTruthy();
    expect(screen.getByText('npm run dev')).toBeTruthy();
  });
});
