import { describe, test, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { HomeView } from '../../components/HomeViewReact';
import { ProjectView } from '../../components/ProjectViewReact';
import { GlobalRunHookDialog } from '../../components/dialogs/GlobalRunHookDialog';
import { useTerminalShortcuts } from '../../components/terminal/terminalShortcuts';
import { useAppStore } from '../../stores/appStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { terminalInstances } from '../../components/terminal/terminalRegistry';
import { beginTransition } from '../../services/taskStartService';
import type { PtySpawnOptions, TaskWithWorkspace } from '../../types';

// xterm cannot construct under jsdom. The stand-in keeps the state the cards
// read and spawns through the mocked IPC, so everything above it is real.
vi.mock('../../components/terminal/terminalReact', () => {
  class FakeTerminal {
    ptyId: string;
    projectPath: string;
    label: string;
    taskId: number | null;
    worktreePath?: string;
    worktreeBranch?: string;
    panels: { id: string; kind: string }[] = [];
    activePanelId: string | null = null;
    panelFullWidth = true;
    panelSplitRatio = 0.5;
    diffPanelOpen = false;
    runnerChildren = new Map();
    isRunner = false;
    xterm = { focus: () => {}, cols: 80, rows: 24, write: () => {} };
    constructor(opts: Record<string, unknown>) {
      this.ptyId = (opts.ptyId as string) ?? `placeholder-${Math.random()}`;
      this.projectPath = opts.projectPath as string;
      this.label = opts.label as string;
      this.taskId = (opts.taskId as number | null) ?? null;
      this.worktreePath = opts.worktreePath as string | undefined;
      this.worktreeBranch = opts.worktreeBranch as string | undefined;
    }
    async spawnPty(options: PtySpawnOptions) {
      const result = await window.api.pty.spawn(options);
      this.ptyId = result.ptyId!;
      return this.ptyId;
    }
    getViewportElement = () => document.createElement('div');
    getActivePanel = () => null;
    toggleDiffPanel() {
      this.diffPanelOpen = !this.diffPanelOpen;
    }
    openTerminal() {}
    reattach() {}
    detach() {}
    fit() {}
    bind() {}
    refreshGitStatus() {}
    setProjectNameGetter() {}
    suppressResizeDuring() {}
    dispose() {}
  }
  return {
    OuijitTerminal: FakeTerminal,
    resolveTerminalLabel: (taskName?: string | null, branch?: string, fallback?: string) =>
      taskName || branch || fallback || 'Shell',
    refreshTerminalsGitStatus: vi.fn(),
    refreshTerminalGitStatus: vi.fn(),
    hydrateTerminalFont: vi.fn(),
  };
});

const ALPHA = { path: '/code/alpha', name: 'Alpha' };
const BRAVO = { path: '/code/bravo', name: 'Bravo' };

function task(over: Partial<TaskWithWorkspace>): TaskWithWorkspace {
  return { taskNumber: 8, name: 'Ship it', status: 'todo', order: 0, createdAt: '2026-10-01T00:00:00Z', ...over };
}

/** What App mounts for the two views, without the chrome around them. */
function Views() {
  useTerminalShortcuts();
  const view = useAppStore((s) => s.activeView);
  return (
    <>
      {view === 'home' ? <HomeView /> : <ProjectView />}
      <GlobalRunHookDialog />
    </>
  );
}

let tasks: Record<string, TaskWithWorkspace[]>;
let spawned: string[];
let finishWorktree: () => void;

const press = (key: string) => fireEvent.keyDown(document.body, { key, metaKey: true, ctrlKey: true });

const frontCard = () => document.querySelector<HTMLElement>('.project-card--active');
const card = (ptyId: string) => document.querySelector<HTMLElement>(`.project-card[data-pty-id="${ptyId}"]`)!;

async function openShell(): Promise<string> {
  const before = spawned.length;
  press('i');
  await waitFor(() => expect(spawned.length).toBe(before + 1));
  const ptyId = spawned[before];
  await waitFor(() => expect(frontCard()?.dataset.ptyId).toBe(ptyId));
  return ptyId;
}

async function openMenu(ptyId: string): Promise<HTMLElement> {
  await waitFor(() => expect(document.querySelector('.context-menu')).toBeNull());
  fireEvent.contextMenu(within(card(ptyId)).getByText('Ship it'));
  return waitFor(() => {
    const menu = document.querySelector<HTMLElement>('.context-menu--visible');
    if (!menu) throw new Error('the menu did not open');
    return menu;
  });
}

beforeEach(() => {
  terminalInstances.clear();
  useTerminalStore.setState(useTerminalStore.getInitialState(), true);
  useAppStore.setState({
    activeView: 'home',
    activeProjectPath: null,
    activeProjectData: null,
    projects: [ALPHA, BRAVO],
    taskCacheByProject: {},
  });
  tasks = { [ALPHA.path]: [task({})], [BRAVO.path]: [] };
  spawned = [];
  vi.mocked(window.api.task.getAll).mockImplementation(async (path) => tasks[path] ?? []);
  vi.mocked(window.api.task.getByNumber).mockImplementation(
    async (path, n) => tasks[path]?.find((t) => t.taskNumber === n) ?? null,
  );
  vi.mocked(window.api.hooks.get).mockImplementation(async (path) =>
    path === ALPHA.path ? { done: { id: 'd', type: 'done', name: 'Done', command: 'echo shipped' } } : {},
  );
  vi.mocked(window.api.task.start).mockImplementation(
    () =>
      new Promise((resolve) => {
        finishWorktree = () => {
          const started = task({ status: 'in_progress', branch: 'ship-it-8', worktreePath: '/wt/T-8' });
          tasks[ALPHA.path] = [started];
          resolve({ success: true, worktreePath: '/wt/T-8', task: started });
        };
      }),
  );
  vi.mocked(window.api.pty.spawn).mockImplementation(async () => {
    const ptyId = `pty-${spawned.length + 1}`;
    spawned.push(ptyId);
    return { success: true, ptyId };
  });
});

describe('a terminal behaves the same in the home view and in its project view', () => {
  test.each([
    ['home', () => useAppStore.getState().navigateHome()],
    [
      'project',
      async () => {
        useAppStore.getState().navigateToProject(ALPHA.path, ALPHA);
        await waitFor(() => expect(document.querySelector('.kanban-board')).toBeTruthy());
      },
    ],
  ])('%s', async (view, show) => {
    render(<Views />);
    // Bravo is the last project opened, so Alpha's terminals on home are not its.
    useAppStore.getState().navigateToProject(BRAVO.path, BRAVO);
    await show();

    // 1. A new shell is active, in front.
    const shell = await openShell();

    // 2. A starting task shows its loading card, then the terminal in its place.
    beginTransition(ALPHA.path, { origStatus: 'todo', newStatus: 'in_progress', task: tasks[ALPHA.path][0] });
    await waitFor(() => expect(frontCard()?.textContent).toContain('Setting up workspace'));
    finishWorktree();
    await waitFor(() => expect(spawned).toHaveLength(2));
    const taskTerminal = spawned[1];
    await waitFor(() => expect(frontCard()?.dataset.ptyId).toBe(taskTerminal));

    // 3. Its header menu has the task's entries, from its own project.
    const taskMenu = await openMenu(taskTerminal);
    expect(within(taskMenu).queryByText('Branch from this task')).toBeTruthy();
    fireEvent.click(within(taskMenu).getByText('Rename task'));
    expect(await within(card(taskTerminal)).findByRole('textbox')).toHaveProperty('value', 'Ship it');
    fireEvent.keyDown(within(card(taskTerminal)).getByRole('textbox'), { key: 'Escape' });

    // 4. Completing it shows the done hook's dialog, naming the project when it isn't the one on screen.
    const menu = await openMenu(taskTerminal);
    fireEvent.mouseEnter(within(menu).getByText('Move to').closest('div')!);
    fireEvent.click(await within(menu).findByText('Done'));
    const title = await screen.findByTestId('dialog-title');
    expect(title.textContent).toBe('Done');
    expect(screen.queryByTestId('hook-project')?.textContent).toBe(view === 'home' ? 'Alpha' : undefined);
    fireEvent.click(screen.getByTestId('dialog-run'));
    await waitFor(() =>
      expect(vi.mocked(window.api.pty.spawn).mock.calls.some(([o]) => o.command === 'echo shipped')).toBe(true),
    );
    await waitFor(() => expect(document.querySelector(`[data-pty-id="${taskTerminal}"]`)).toBeNull());

    // 5. Closing the active terminal promotes the one used before it.
    const second = await openShell();
    fireEvent.click(card(shell));
    await waitFor(() => expect(frontCard()?.dataset.ptyId).toBe(shell));
    press('w');
    await waitFor(() => expect(frontCard()?.dataset.ptyId).toBe(second));
  });
});
