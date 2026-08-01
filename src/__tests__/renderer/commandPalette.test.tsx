import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

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
  terminalInstances: new Map(),
}));

import { CommandPalette } from '../../components/CommandPalette';
import { usePaletteShortcut } from '../../hooks/usePaletteShortcut';
import { addProjectTerminal, reconnectOrphanedSessions } from '../../components/terminal/terminalActions';
import { useAppStore } from '../../stores/appStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTerminalStore, DEFAULT_DISPLAY_STATE, type TerminalDisplayState } from '../../stores/terminalStore';
import { useUIStore } from '../../stores/uiStore';
import type { ActiveSession, Project, TaskWithWorkspace } from '../../types';

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
    task({ taskNumber: 9, name: 'Nine', worktreePath: '/wt/nine', branch: 'nine' }),
    // No worktree: the palette must not offer to start it.
    task({ taskNumber: 11, name: 'Eleven' }),
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
  useProjectStore.setState({ tagFilter: null, terminalLayout: 'stack', kanbanVisible: true });
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
  test('lists switchable terminals, projects and worktree-backed tasks, without duplicates', async () => {
    await openPalette();
    const labels = rowLabels();

    // Terminals: store-hydrated and not-yet-hydrated sessions, deduped by ptyId.
    expect(labels.filter((l) => l.includes('Alpha shell'))).toHaveLength(1);
    expect(labels.some((l) => l.includes('Bravo agent'))).toBe(true);

    // Runners are panels on a parent card, never their own row.
    expect(labels.some((l) => l.includes('npm run dev'))).toBe(false);

    // Task 7 already has a live terminal, so it lists once — as that terminal.
    expect(labels.filter((l) => l.includes('T-7'))).toHaveLength(1);
    // Task 9 has a worktree and no terminal, so it lists as a task.
    expect(labels.some((l) => l.includes('Nine'))).toBe(true);
    // Task 11 has no worktree — opening it would have to create one.
    expect(labels.some((l) => l.includes('Eleven'))).toBe(false);

    // Projects are listed too.
    expect(labels.some((l) => l.includes('Bravo') && l.includes('/work/bravo'))).toBe(true);

    // Sections keep their order: terminals, then projects, then tasks.
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
    // A switcher never starts a task.
    expect(window.api.task.start).not.toHaveBeenCalled();
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
