import { describe, test, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { ManagedTasks } from '../../components/chat/ManagedTasks';
import { useAppStore } from '../../stores/appStore';
import { useHomeChatStore } from '../../stores/homeChatStore';
import { DEFAULT_DISPLAY_STATE, useTerminalStore, type TerminalDisplayState } from '../../stores/terminalStore';
import type { TaskWithWorkspace } from '../../types';

// xterm cannot construct under jsdom; nothing here opens a terminal.
vi.mock('../../components/terminal/terminalReact', () => ({
  OuijitTerminal: class {},
  resolveTerminalLabel: () => 'Shell',
  refreshTerminalsGitStatus: vi.fn(),
  refreshTerminalGitStatus: vi.fn(),
  hydrateTerminalFont: vi.fn(),
}));

const APP = '/code/app';
const SITE = '/code/site';
const CHAT = 'home-1';

const task = (taskNumber: number, name: string, status: TaskWithWorkspace['status']) =>
  ({ taskNumber, name, status, createdAt: '' }) as TaskWithWorkspace;

function seed(ptyId: string, over: Partial<TerminalDisplayState>): void {
  useTerminalStore.getState().addTerminal(over.projectPath ?? APP, ptyId, { ...DEFAULT_DISPLAY_STATE, ptyId, ...over });
}

const follow = (...refs: [string, number][]) =>
  act(() =>
    useHomeChatStore.setState({
      following: { [CHAT]: refs.map(([projectPath, taskNumber]) => ({ projectPath, taskNumber })) },
    }),
  );

beforeEach(() => {
  useTerminalStore.setState({ displayStates: {}, terminalsByProject: {}, order: [] });
  useAppStore.setState({
    projects: [{ path: APP, name: 'App' } as never, { path: SITE, name: 'Site' } as never],
    taskCacheByProject: {
      [APP]: [
        task(12, 'Fix session timeout', 'in_progress'),
        task(14, 'Ship it', 'done'),
        task(16, 'Write the docs', 'in_progress'),
      ],
      [SITE]: [task(3, 'Pricing page', 'in_review')],
    },
    selection: { kind: 'chat' } as never,
  });
});

describe('the tasks Chat manages, above its composer', () => {
  test('fold to one line marked by what most needs you, open to the sidebar rows, and leave once done', () => {
    seed('fix', { taskId: 12, status: 'thinking' });
    seed('docs', { taskId: 16, status: 'ready' });
    seed('pricing', { projectPath: SITE, taskId: 3, status: 'ready' });
    act(() => useTerminalStore.getState().updateDisplay('pricing', { status: 'thinking' }));
    follow([APP, 12], [APP, 14], [APP, 16], [SITE, 3]);
    render(<ManagedTasks conversation={CHAT} />);
    const bar = () => screen.getByLabelText('Tasks Chat is managing');
    const marks = () =>
      within(bar())
        .queryAllByTestId('group-mark')
        .map((mark) => mark.dataset.state);

    // Folded: a count and one mark, the done task already gone from it.
    expect(screen.getByRole('button', { name: /^3 tasks/ })).toBeTruthy();
    expect(marks()).toEqual(['thinking']);
    expect(screen.queryByText('Fix session timeout')).toBeNull();

    // Opened: each task as its sidebar row shows it, and the header mark gives way to theirs.
    fireEvent.click(screen.getByRole('button', { name: /^3 tasks/ }));
    const rows = [...bar().querySelectorAll('[data-sidebar-row]')];
    expect(rows.map((row) => row.textContent)).toEqual([
      'Fix session timeoutApp',
      'Write the docsApp',
      'Pricing pageSite',
    ]);
    expect(
      rows.map((row) =>
        within(row as HTMLElement)
          .getByRole('img')
          .getAttribute('aria-label'),
      ),
    ).toEqual(['In Progress', 'In Progress', 'In Review']);
    expect(marks()).toEqual(['thinking', 'ready', 'thinking']);

    // A row opens the task's card.
    fireEvent.click(within(rows[1] as HTMLElement).getByText('Write the docs'));
    expect(useAppStore.getState().selection).toMatchObject({ kind: 'terminal', projectPath: APP });
    expect(useTerminalStore.getState().order[0]).toBe('docs');

    // One left: just its row, no count.
    follow([APP, 16]);
    expect(screen.queryByRole('button', { name: /tasks$/ })).toBeNull();
    expect(bar().querySelectorAll('[data-sidebar-row]')).toHaveLength(1);

    // None: nothing above the composer.
    follow();
    expect(screen.queryByLabelText('Tasks Chat is managing')).toBeNull();
  });
});
