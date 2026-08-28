import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { CommandPalette } from '../../components/CommandPalette';
import { usePaletteShortcut } from '../../hooks/usePaletteShortcut';
import { addProjectTerminal, reconnectOrphanedSessions } from '../../components/terminal/terminalActions';
import { useAppStore } from '../../stores/appStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTerminalStore, DEFAULT_DISPLAY_STATE, type TerminalDisplayState } from '../../stores/terminalStore';
import { useUIStore } from '../../stores/uiStore';
import type { ActiveSession, Project, TaskWithWorkspace } from '../../types';

vi.mock('electron-log/renderer', () => ({
  default: { scope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// The palette reaches terminals through `navigation`, which pulls in the real
// terminal machinery (xterm). Both sides are stubbed: `terminalActions` so
// spawning/reconnecting is observable, `terminalReact` so no xterm is
// constructed in jsdom.
vi.mock('../../components/terminal/terminalActions', () => ({
  addProjectTerminal: vi.fn().mockResolvedValue(true),
  reconnectOrphanedSessions: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../components/terminal/terminalReact', () => ({
}));

const projectA: Project = { path: '/work/alpha', name: 'Alpha' };
const projectB: Project = { path: '/work/bravo', name: 'Bravo' };

function display(over: Partial<TerminalDisplayState> & { ptyId: string; projectPath: string }): TerminalDisplayState {
  return { ...DEFAULT_DISPLAY_STATE, ...over } as TerminalDisplayState;
}

function task(over: Partial<TaskWithWorkspace> & { taskNumber: number }): TaskWithWorkspace {
  return {
    name: `Task ${over.taskNumber}`,
    status: 'in_progress',
    createdAt: '2026-07-01T00:00:00.000Z',
    ...over,
  } as TaskWithWorkspace;
}

/**
 * One live session per surface the palette has to reconcile:
 *   alpha-1  hydrated in the store, in the active project
 *   bravo-1  live but never hydrated by this renderer
 *   bravo-r  a runner — a panel on a card, not a switchable terminal
 *   alpha-7  hydrated, backs task 7 (so task 7 must not also list as a task)
 */
const SESSIONS: ActiveSession[] = [
  { ptyId: 'alpha-1', projectPath: projectA.path, command: '', label: 'Alpha shell' },
  { ptyId: 'alpha-7', projectPath: projectA.path, command: '', label: 'Seven', taskId: 7 },
  { ptyId: 'bravo-1', projectPath: projectB.path, command: '', label: 'Bravo agent' },
  { ptyId: 'bravo-r', projectPath: projectB.path, command: 'npm run dev', label: 'dev', isRunner: true },
];

const TASKS: Record<string, TaskWithWorkspace[]> = {
  [projectA.path]: [
    task({ taskNumber: 7, name: 'Seven', worktreePath: '/wt/seven', branch: 'seven' }),
    task({ taskNumber: 9, name: 'Nine', worktreePath: '/wt/nine', branch: 'nine', prompt: 'Rewire the scheduler' }),
    // No worktree yet: listed, but there is nothing to open.
    task({ taskNumber: 11, name: 'Eleven', status: 'todo' }),
    task({ taskNumber: 12, name: 'Cache invalidation', branch: 'fix/cache-headers', worktreePath: '/wt/twelve' }),
  ],
  [projectB.path]: [],
};

function seed(): void {
  useAppStore.setState({
    projects: [projectA, projectB],
    activeView: 'project',
    activeProjectPath: projectA.path,
    activeProjectData: projectA,
    taskCacheByProject: { ...TASKS },
  });
  useTerminalStore.setState({
    terminalsByProject: { [projectA.path]: ['alpha-1', 'alpha-7'] },
    displayStates: {
      'alpha-1': display({ ptyId: 'alpha-1', projectPath: projectA.path, label: 'Alpha shell' }),
      'alpha-7': display({ ptyId: 'alpha-7', projectPath: projectA.path, label: 'Seven', taskId: 7 }),
    },
    activeIndices: { [projectA.path]: 0 },
  });
  useProjectStore.setState({
    tagFilter: null,
    terminalLayout: 'stack',
    kanbanVisible: true,
    toasts: [],
    startingTaskNumbers: new Set<number>(),
  });
  useUIStore.setState({ paletteOpen: true, homeActivePtyId: null, homeTagFilter: null });
}

function rowLabels(): string[] {
  return screen.queryAllByTestId('palette-row').map((row) => row.textContent ?? '');
}

/** Wait for the async `getActiveSessions` fetch to land in the list. */
async function openPalette() {
  render(<CommandPalette />);
  await waitFor(() => expect(rowLabels().some((l) => l.includes('Bravo agent'))).toBe(true));
}

beforeEach(() => {
  vi.clearAllMocks();
  window.api.pty.getActiveSessions = vi.fn().mockResolvedValue(SESSIONS);
  // Opening the palette kicks off a background task-cache refresh, so the IPC
  // has to agree with the seeded cache or it would wipe it.
  window.api.task.getAll = vi.fn(async (path: string) => TASKS[path] ?? []);
  window.api.globalSettings.set = vi.fn().mockResolvedValue({ success: true });
  window.api.globalSettings.get = vi.fn().mockResolvedValue(undefined);
  // Answers from the same fixture the palette lists, so a task opens into the
  // worktree its row describes.
  window.api.task.checkWorktree = vi.fn(async (path: string, taskNumber: number) => {
    const worktreePath = (TASKS[path] ?? []).find((t) => t.taskNumber === taskNumber)?.worktreePath;
    return worktreePath
      ? ({ status: 'present', worktreePath } as const)
      : ({ status: 'missing', branchExists: false } as const);
  });
  vi.mocked(addProjectTerminal).mockResolvedValue(true);
  vi.mocked(reconnectOrphanedSessions).mockResolvedValue(undefined);
  seed();
});

function Harness() {
  usePaletteShortcut();
  return <CommandPalette />;
}

describe('mod+K shortcut', () => {
  test('toggles the palette open and closed', () => {
    useUIStore.setState({ paletteOpen: false });
    render(<Harness />);
    expect(screen.queryByTestId('command-palette')).toBeNull();

    // jsdom reports a non-mac platform, so the modifier is ctrl.
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(useUIStore.getState().paletteOpen).toBe(true);

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(useUIStore.getState().paletteOpen).toBe(false);

    // Unmodified `k` is just a keystroke.
    fireEvent.keyDown(document, { key: 'k' });
    expect(useUIStore.getState().paletteOpen).toBe(false);
  });
});

describe('command palette results', () => {
  test('lists every task once, alongside non-task terminals and projects', async () => {
    await openPalette();
    const labels = rowLabels();

    // Terminals: store-hydrated and not-yet-hydrated sessions, deduped by ptyId.
    expect(labels.filter((l) => l.includes('Alpha shell'))).toHaveLength(1);
    expect(labels.some((l) => l.includes('Bravo agent'))).toBe(true);

    // Runners are panels on a parent card, never their own row.
    expect(labels.some((l) => l.includes('npm run dev'))).toBe(false);

    // Task 7 has a live terminal. There is exactly one task row for it, and the
    // shell hangs off that row as a branch rather than listing under Terminals.
    expect(labels.filter((l) => l.includes('T-7'))).toHaveLength(1);
    expect(labels.some((l) => l.includes('└─') && l.includes('Seven'))).toBe(true);
    // A task with a worktree and one with nothing at all both list.
    expect(labels.some((l) => l.includes('Nine'))).toBe(true);
    expect(labels.some((l) => l.includes('Eleven'))).toBe(true);

    // Projects are listed too.
    expect(labels.some((l) => l.includes('Bravo') && l.includes('/work/bravo'))).toBe(true);

    // With no query the browse groups keep their order.
    expect(screen.getAllByText(/^(Terminals|Projects|Tasks)$/).map((n) => n.textContent)).toEqual([
      'Terminals',
      'Projects',
      'Tasks',
    ]);
  });

  test('filters fuzzily and Escape closes', async () => {
    await openPalette();
    const input = screen.getByLabelText('Search terminals, projects and tasks');

    fireEvent.change(input, { target: { value: 'brv' } });
    await waitFor(() => expect(rowLabels().some((l) => l.includes('Bravo agent'))).toBe(true));
    expect(rowLabels().some((l) => l.includes('Alpha shell'))).toBe(false);

    fireEvent.change(input, { target: { value: 'zzzz' } });
    expect(screen.getByText('No matches')).toBeTruthy();

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(useUIStore.getState().paletteOpen).toBe(false);
  });

  test('ranks the best match first regardless of type, and searches beyond the title', async () => {
    await openPalette();
    const input = screen.getByLabelText('Search terminals, projects and tasks');

    // A task number, in either form. Under the old per-type sections a
    // terminal always took the first row; the digits weren't searchable at all.
    fireEvent.change(input, { target: { value: 'T-12' } });
    await waitFor(() => expect(rowLabels()[0]).toContain('Cache invalidation'));
    fireEvent.change(input, { target: { value: '12' } });
    await waitFor(() => expect(rowLabels()[0]).toContain('Cache invalidation'));

    // Branch, prompt and status are all searchable, and the row says which
    // field it matched on so the result doesn't look arbitrary.
    fireEvent.change(input, { target: { value: 'cache-headers' } });
    await waitFor(() => expect(rowLabels()[0]).toContain('Cache invalidation'));
    expect(rowLabels()[0]).toContain('branch');

    fireEvent.change(input, { target: { value: 'scheduler' } });
    await waitFor(() => expect(rowLabels()[0]).toContain('Nine'));

    // Statuses read and match by the board's own column names.
    fireEvent.change(input, { target: { value: 'to do' } });
    await waitFor(() => expect(rowLabels()[0]).toContain('Eleven'));
    expect(rowLabels()[0]).toContain('To Do');

    fireEvent.change(input, { target: { value: 'in progress' } });
    await waitFor(() => expect(rowLabels()[0]).toContain('In Progress'));

    // An exact name still outranks a lower-weight field's exact hit.
    fireEvent.change(input, { target: { value: 'Seven' } });
    await waitFor(() => expect(rowLabels()[0]).toContain('Seven'));
  });

  test("a task's shells branch off its row, each one its own target", async () => {
    // Two shells on task 7, so the mid/last glyphs and per-shell targeting
    // both matter.
    useTerminalStore.setState({
      terminalsByProject: { [projectA.path]: ['alpha-7', 'alpha-7b'] },
      displayStates: {
        'alpha-7': display({ ptyId: 'alpha-7', projectPath: projectA.path, label: 'claude', taskId: 7 }),
        'alpha-7b': display({ ptyId: 'alpha-7b', projectPath: projectA.path, label: 'npm test', taskId: 7 }),
      },
      activeIndices: { [projectA.path]: 0 },
    });

    await openPalette();
    const input = screen.getByLabelText('Search terminals, projects and tasks');
    // Found by a shell's label, since the task now owns those rows.
    fireEvent.change(input, { target: { value: 'npm test' } });

    await waitFor(() => expect(rowLabels()[0]).toContain('T-7'));
    expect(rowLabels()[1]).toContain('├─');
    expect(rowLabels()[1]).toContain('claude');
    expect(rowLabels()[2]).toContain('└─');
    expect(rowLabels()[2]).toContain('npm test');

    // Arrow down twice past the task row lands on the second shell, and Enter
    // focuses that one rather than whichever sorted first.
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(useTerminalStore.getState().activeIndices[projectA.path]).toBe(1));
  });

  test('a project row searches and shows the same home-relative path', async () => {
    // Row text and match ranges have to index the same string, or the
    // highlight lands on the wrong characters.
    useAppStore.setState({ projects: [projectA, { path: '/Users/someone/Code/horizon', name: 'Horizon' }] });

    await openPalette();
    const input = screen.getByLabelText('Search terminals, projects and tasks');
    fireEvent.change(input, { target: { value: '~/Code/horizon' } });

    await waitFor(() => expect(rowLabels()[0]).toContain('~/Code/horizon'));
    expect(rowLabels()[0]).not.toContain('/Users/someone');
  });

  test('the footer names what Enter will do for the selected row', async () => {
    await openPalette();
    const input = screen.getByLabelText('Search terminals, projects and tasks');

    fireEvent.change(input, { target: { value: 'Nine' } });
    await waitFor(() => expect(screen.getByText('Open worktree')).toBeTruthy());

    // Task 7 is live, so its row focuses the running shell instead.
    fireEvent.change(input, { target: { value: 'Seven' } });
    await waitFor(() => expect(screen.getByText('Focus terminal')).toBeTruthy());

    // No worktree yet, so opening it has to create one first.
    fireEvent.change(input, { target: { value: 'Eleven' } });
    await waitFor(() => expect(screen.getByText('Start task')).toBeTruthy());
  });
});

describe('command palette navigation', () => {
  test('opens a terminal from a project this renderer never hydrated', async () => {
    // Reconnecting is what registers the session in the store.
    vi.mocked(reconnectOrphanedSessions).mockImplementation(async (projectPath?: string) => {
      if (projectPath !== projectB.path) return;
      useTerminalStore.getState().addTerminal(projectB.path, 'bravo-1', { label: 'Bravo agent' });
    });

    await openPalette();
    const input = screen.getByLabelText('Search terminals, projects and tasks');
    fireEvent.change(input, { target: { value: 'Bravo agent' } });
    await waitFor(() => expect(rowLabels()[0]).toContain('Bravo agent'));
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(reconnectOrphanedSessions).toHaveBeenCalledWith(projectB.path));
    await waitFor(() => expect(useAppStore.getState().activeProjectPath).toBe(projectB.path));

    const terminals = useTerminalStore.getState().terminalsByProject[projectB.path] ?? [];
    expect(useTerminalStore.getState().activeIndices[projectB.path]).toBe(terminals.indexOf('bravo-1'));
    // Jumping to a terminal shows the terminals, not the board.
    expect(useProjectStore.getState().kanbanVisible).toBe(false);
    expect(useProjectStore.getState().activePanel).toBe('terminals');
  });

  test('clears a tag filter that would hide the terminal being opened', async () => {
    // The card stack resets the active index back to the visible head, so
    // without this the jump would silently bounce.
    useProjectStore.setState({ tagFilter: 'review' });
    useTerminalStore.setState({
      terminalsByProject: { [projectA.path]: ['alpha-1', 'alpha-7'] },
      displayStates: {
        'alpha-1': display({ ptyId: 'alpha-1', projectPath: projectA.path, label: 'Alpha shell' }),
        'alpha-7': display({
          ptyId: 'alpha-7',
          projectPath: projectA.path,
          label: 'Seven',
          taskId: 7,
          tags: ['review'],
        }),
      },
      activeIndices: { [projectA.path]: 1 },
    });

    await openPalette();
    const input = screen.getByLabelText('Search terminals, projects and tasks');
    fireEvent.change(input, { target: { value: 'Alpha shell' } });
    await waitFor(() => expect(rowLabels()[0]).toContain('Alpha shell'));
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(useProjectStore.getState().tagFilter).toBeNull());
    expect(useTerminalStore.getState().activeIndices[projectA.path]).toBe(0);
  });

  test('opens a task worktree as a plain shell — no hook, no worktree creation', async () => {
    await openPalette();
    const input = screen.getByLabelText('Search terminals, projects and tasks');
    fireEvent.change(input, { target: { value: 'Nine' } });
    await waitFor(() => expect(rowLabels()[0]).toContain('Nine'));
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(addProjectTerminal).toHaveBeenCalled());
    expect(addProjectTerminal).toHaveBeenCalledWith(projectA.path, undefined, {
      existingWorktree: { path: '/wt/nine', branch: 'nine', createdAt: '2026-07-01T00:00:00.000Z' },
      taskId: 9,
      skipAutoHook: true,
    });
    // The worktree already exists, so there is nothing to start.
    expect(window.api.task.start).not.toHaveBeenCalled();
  });

  test('a task with no worktree stages a loading card, then starts and opens it', async () => {
    // Hold the start open so the staged state is observable, the way it is on
    // screen while git creates the worktree.
    let releaseStart: (v: unknown) => void = () => {};
    window.api.task.start = vi.fn().mockReturnValue(new Promise((r) => (releaseStart = r)));

    await openPalette();
    const input = screen.getByLabelText('Search terminals, projects and tasks');
    fireEvent.change(input, { target: { value: 'Eleven' } });
    await waitFor(() => expect(rowLabels()[0]).toContain('Eleven'));
    fireEvent.keyDown(input, { key: 'Enter' });

    // Mid-start: a loading card is already in the stack, so the user is looking
    // at the task rather than at nothing.
    await waitFor(() => expect(useProjectStore.getState().startingTaskNumbers.has(11)).toBe(true));
    const staged = Object.values(useTerminalStore.getState().displayStates).find((d) => d.taskId === 11);
    expect(staged).toMatchObject({ label: 'Eleven', isLoading: true });
    expect(useProjectStore.getState().kanbanVisible).toBe(false);

    releaseStart({ success: true, worktreePath: '/wt/eleven', task: { branch: 'eleven' } });

    // The real terminal takes the staged slot's place rather than appending.
    await waitFor(() =>
      expect(addProjectTerminal).toHaveBeenCalledWith(projectA.path, undefined, {
        existingWorktree: { path: '/wt/eleven', branch: 'eleven', createdAt: '2026-07-01T00:00:00.000Z' },
        taskId: 11,
        skipAutoHook: true,
        replaceLoadingId: staged?.ptyId,
      }),
    );
    await waitFor(() => expect(useProjectStore.getState().startingTaskNumbers.has(11)).toBe(false));
  });

  test('a failed start clears the staged card and surfaces the error', async () => {
    window.api.task.start = vi.fn().mockResolvedValue({ success: false, error: 'branch exists' });

    await openPalette();
    const input = screen.getByLabelText('Search terminals, projects and tasks');
    fireEvent.change(input, { target: { value: 'Eleven' } });
    await waitFor(() => expect(rowLabels()[0]).toContain('Eleven'));
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(useProjectStore.getState().toasts[0]?.message).toBe('branch exists'));
    expect(addProjectTerminal).not.toHaveBeenCalled();
    // No orphan card left behind that would never resolve.
    expect(Object.values(useTerminalStore.getState().displayStates).some((d) => d.isLoading)).toBe(false);
    expect(useProjectStore.getState().startingTaskNumbers.has(11)).toBe(false);
  });

  test('leads the Recent group with what has been visited, whatever surface did it', async () => {
    window.api.globalSettings.get = vi.fn(async (key: string) =>
      key === 'ui:palette-visits'
        ? JSON.stringify({
            [`task:${projectA.path}#7`]: { visitedAtMs: Date.now(), visits: 4 },
            [`project:${projectB.path}`]: { visitedAtMs: Date.now(), visits: 3 },
          })
        : undefined,
    );

    await openPalette();
    await waitFor(() => expect(screen.getByText('Recent')).toBeTruthy());
    const top = rowLabels().slice(0, 3).join(' ');
    expect(top).toContain('/work/bravo');
    expect(top).toContain('T-7');
  });

  test('activating a row does not itself record a visit', async () => {
    await openPalette();
    const input = screen.getByLabelText('Search terminals, projects and tasks');
    fireEvent.change(input, { target: { value: 'Nine' } });
    await waitFor(() => expect(rowLabels()[0]).toContain('Nine'));
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(vi.mocked(addProjectTerminal)).toHaveBeenCalled());
    expect(vi.mocked(window.api.globalSettings.set).mock.calls.some(([key]) => key === 'ui:palette-visits')).toBe(
      false,
    );
  });

  test('selecting a project loads its tasks, navigates, and persists the view', async () => {
    await openPalette();
    const input = screen.getByLabelText('Search terminals, projects and tasks');
    fireEvent.change(input, { target: { value: '/work/bravo' } });
    await waitFor(() => expect(rowLabels()[0]).toContain('Bravo'));
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(useAppStore.getState().activeProjectPath).toBe(projectB.path));
    expect(window.api.task.getAll).toHaveBeenCalledWith(projectB.path);
    expect(window.api.globalSettings.set).toHaveBeenCalledWith(
      'lastActiveView',
      JSON.stringify({ type: 'project', path: projectB.path }),
    );
  });
});
