import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Sidebar } from '../../components/SidebarReact';
import { MainView } from '../../components/MainView';
import { useTerminalShortcuts } from '../../components/terminal/terminalShortcuts';
import { addProjectTerminal } from '../../components/terminal/terminalActions';
import { terminalInstances } from '../../components/terminal/terminalRegistry';
import { useAppStore } from '../../stores/appStore';
import { useUIStore } from '../../stores/uiStore';
import { DEFAULT_DISPLAY_STATE, useTerminalStore, type TerminalDisplayState } from '../../stores/terminalStore';
import type { GitFileStatus, PtySpawnOptions, TaskWithWorkspace } from '../../types';

// xterm cannot construct under jsdom. The stand-in keeps the state the cards
// read and spawns through the mocked IPC, so everything above it is real.
vi.mock('../../components/terminal/terminalReact', () => {
  class FakeTerminal {
    ptyId: string;
    projectPath: string;
    label: string;
    taskId: number | null;
    worktreePath?: string;
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
    }
    async spawnPty(options: PtySpawnOptions) {
      const result = await window.api.pty.spawn(options);
      this.ptyId = result.ptyId!;
      return this.ptyId;
    }
    getViewportElement = () => document.createElement('div');
    getActivePanel = () => null;
    toggleDiffPanel() {}
    openTerminal() {}
    reattach() {}
    detach() {}
    fit() {}
    bind() {}
    loadTags() {}
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
const HOME = '/Users/test';

function task(over: Partial<TaskWithWorkspace>): TaskWithWorkspace {
  return { taskNumber: 1, name: 'Task', status: 'in_progress', order: 0, createdAt: '2026-10-01T00:00:00Z', ...over };
}

const TASKS: Record<string, TaskWithWorkspace[]> = {
  [ALPHA.path]: [
    task({ taskNumber: 8, name: 'Ship it', status: 'in_progress', order: 1 }),
    task({ taskNumber: 9, name: 'Write docs', status: 'in_review', order: 0 }),
    task({ taskNumber: 10, name: 'Plan it', status: 'todo', order: 0 }),
    task({ taskNumber: 11, name: 'Tidy up', status: 'in_progress', order: 0 }),
  ],
  [BRAVO.path]: [task({ taskNumber: 3, name: 'Pricing page' })],
};

let spawned: string[];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(1_000_000);
  terminalInstances.clear();
  useTerminalStore.setState(useTerminalStore.getInitialState(), true);
  useUIStore.setState(useUIStore.getInitialState(), true);
  useAppStore.setState({ projects: [ALPHA, BRAVO], taskCacheByProject: { ...TASKS } });
  useAppStore.getState().select({ kind: 'none' });
  spawned = [];
  vi.mocked(window.api.task.getAll).mockImplementation(async (path) => TASKS[path] ?? []);
  vi.mocked(window.api.task.getByNumber).mockImplementation(
    async (path, n) => TASKS[path]?.find((t) => t.taskNumber === n) ?? null,
  );
  vi.mocked(window.api.pty.spawn).mockImplementation(async () => {
    const ptyId = `pty-${spawned.length + 1}`;
    spawned.push(ptyId);
    return { success: true, ptyId };
  });
});

afterEach(() => vi.useRealTimers());

const tick = (ms: number) => vi.setSystemTime(Date.now() + ms);
const press = (key: string) => fireEvent.keyDown(document.body, { key, metaKey: true, ctrlKey: true });
const display = (ptyId: string) => useTerminalStore.getState().displayStates[ptyId];
const front = () => document.querySelector<HTMLElement>('.project-card--active')?.dataset.ptyId;
const cards = () => [...document.querySelectorAll<HTMLElement>('.project-card')].map((c) => c.dataset.ptyId).sort();
const sidebar = () => screen.getByRole('complementary', { name: 'Sidebar' });
const section = (name: string) => within(sidebar()).getByRole('region', { name });
/** A row's clickable title, found by the text it shows. */
const row = (scope: HTMLElement, title: string) =>
  within(scope).getAllByText(title, { selector: 'span' })[0].closest('button')!;

async function spawn(projectPath: string, taskId?: number): Promise<string> {
  await act(async () => {
    await addProjectTerminal(projectPath, undefined, {
      taskId,
      existingWorktree: taskId ? { path: `/wt/${taskId}`, branch: `t-${taskId}`, createdAt: '' } : undefined,
      skipAutoHook: true,
    });
  });
  return spawned[spawned.length - 1];
}

function App() {
  useTerminalShortcuts();
  return (
    <>
      <Sidebar onAddProject={() => {}} onCloneSelect={() => {}} />
      <MainView />
    </>
  );
}

describe('the sidebar is the navigation', () => {
  test('a terminal opened from the tree, Waiting for you or the board shows its task stack and stamps the one left', async () => {
    const ship1 = await spawn(ALPHA.path, 8);
    const ship2 = await spawn(ALPHA.path, 8);
    const docs = await spawn(ALPHA.path, 9);
    const pricing = await spawn(BRAVO.path, 3);
    render(<App />);
    const projects = section('Projects');

    // From the tree: a single-terminal task row is its terminal.
    fireEvent.click(row(projects, 'Write docs'));
    await waitFor(() => expect(front()).toBe(docs));
    expect(cards()).toEqual([docs]);
    expect(useAppStore.getState().activeProjectPath).toBe(ALPHA.path);

    // A task with several opens the one used last, with only its own terminals behind it.
    tick(1000);
    fireEvent.click(row(projects, 'Ship it'));
    await waitFor(() => expect(front()).toBe(ship2));
    expect(cards()).toEqual([ship1, ship2].sort());
    expect(display(docs).lastViewedAt).toBe(Date.now());

    // ⌘1 counts the task's back cards, and the sub-rows follow the front.
    press('1');
    await waitFor(() => expect(front()).toBe(ship1));
    expect(within(projects).getAllByRole('button', { current: true })).toHaveLength(1);

    // An agent finishing off-screen waits for you; opening it keeps it listed, selected, until it is left.
    expect(within(section('Waiting for you')).getByText('All caught up')).toBeTruthy();
    tick(1000);
    act(() => {
      useTerminalStore.getState().updateDisplay(pricing, { status: 'thinking' });
      useTerminalStore.getState().updateDisplay(pricing, { status: 'ready' });
    });
    tick(60_000);
    const waiting = section('Waiting for you');
    expect(within(waiting).queryByText('All caught up')).toBeNull();
    fireEvent.click(row(waiting, 'Pricing page'));
    await waitFor(() => expect(front()).toBe(pricing));
    expect(row(section('Waiting for you'), 'Pricing page').getAttribute('aria-current')).toBe('true');
    expect(useAppStore.getState().activeProjectPath).toBe(BRAVO.path);

    // From the board: the page button opens it, and its terminal rows open their terminal.
    tick(1000);
    const alpha = document.querySelector<HTMLElement>(`[data-project-path="${ALPHA.path}"]`)!;
    fireEvent.click(within(alpha).getByLabelText('Board'));
    await waitFor(() => expect(document.querySelector('.kanban-board')).toBeTruthy());
    expect(useAppStore.getState().selection).toEqual({ kind: 'page', projectPath: ALPHA.path, page: 'board' });
    expect(display(pricing).lastViewedAt).toBe(Date.now());
    expect(within(section('Waiting for you')).getByText('All caught up')).toBeTruthy();

    // The task is collapsed away in the sidebar; opening its terminal reveals it.
    fireEvent.click(within(alpha).getByLabelText('Hide Alpha'));
    expect(within(section('Projects')).queryByText('Ship it')).toBeNull();
    const board = document.querySelector<HTMLElement>('.kanban-board')!;
    fireEvent.click(
      within(board)
        .getAllByText('Ship it')
        .find((el) => el.closest('[class*="flex-row"]'))!,
    );
    await waitFor(() => expect(front()).toBe(ship1));
    expect(within(section('Projects')).getAllByText('Ship it').length).toBeGreaterThan(0);

    // Closing the front terminal brings the task's next one forward; closing
    // a task's last terminal moves to the project's next most recent.
    press('w');
    await waitFor(() => expect(front()).toBe(ship2));
    press('w');
    await waitFor(() => expect(front()).toBe(docs));
  });
});

describe('the sidebar tree', () => {
  function seed(ptyId: string, over: Partial<TerminalDisplayState>): void {
    useTerminalStore.getState().addTerminal(over.projectPath ?? ALPHA.path, ptyId, {
      ...DEFAULT_DISPLAY_STATE,
      ...over,
    });
  }

  const diff: GitFileStatus = {
    branch: 't-8',
    mainBranch: 'main',
    base: 'main',
    commitsAheadOfMain: 1,
    changedFiles: [{ path: 'a.ts', status: 'M', additions: 400, deletions: 168 }],
    untrackedFiles: [{ path: 'b.ts', status: '?', additions: 12, deletions: 0 }],
  } as GitFileStatus;

  test('lists tasks in board order, branches multi-terminal tasks, groups by tag, and keeps every terminal reachable', async () => {
    seed('docs', { taskId: 9, label: 'Write docs', tags: ['Docs'] });
    seed('ship-a', { taskId: 8, label: 'Ship it', lastOscTitle: 'claude', gitFileStatus: diff, tags: ['release'] });
    seed('ship-b', { taskId: 8, label: 'npm test', tags: ['docs'] });
    seed('tidy', { taskId: 11, label: 'Tidy up' });
    seed('plan', { taskId: 10, label: 'Plan it' });
    seed('shell', { label: 'zsh' });
    seed('pricing', { projectPath: BRAVO.path, taskId: 3, label: 'Pricing page', status: 'thinking' });
    seed('home', { projectPath: HOME, label: 'Home shell' });
    // Finished after it was last looked at, so it reads bright.
    tick(1000);
    useTerminalStore.getState().updateDisplay('tidy', { status: 'thinking' });
    useTerminalStore.getState().updateDisplay('tidy', { status: 'ready' });

    render(<Sidebar onAddProject={() => {}} onCloneSelect={() => {}} />);
    const rows = () =>
      [
        ...section(useUIStore.getState().sidebarGroupMode === 'tag' ? 'Tags' : 'Projects').querySelectorAll(
          '[data-group], [data-sidebar-row]',
        ),
      ].map((el) => el.getAttribute('data-group') ?? el.textContent);

    // To Do, In Progress by board order, In Review; the task's diff; a branch per terminal; shells last.
    expect(rows()).toEqual([
      ALPHA.path,
      'Plan it',
      'Tidy up',
      'Ship it+412 −168',
      '└npm test',
      '└claude',
      'Write docs',
      'zsh',
      BRAVO.path,
      'Pricing page',
      HOME,
      'Home shell',
    ]);
    expect(within(section('Projects')).getByText('~')).toBeTruthy();
    expect(row(section('Projects'), 'Tidy up').dataset.bright).toBe('true');
    expect(row(section('Projects'), 'Write docs').dataset.bright).toBeUndefined();
    expect(row(section('Waiting for you'), 'Tidy up')).toBeTruthy();

    // A folded project still shows what is working or waiting in it.
    fireEvent.click(screen.getByLabelText('Hide Bravo'));
    expect(
      within(document.querySelector<HTMLElement>(`[data-project-path="${BRAVO.path}"]`)!).getByTestId('group-dots'),
    ).toBeTruthy();

    // By tag: a task sits under each tag its terminals carry, listing only those terminals,
    // with its project where the diff was; the rest go under No tag.
    fireEvent.click(screen.getByRole('tab', { name: 'Tags' }));
    expect(rows()).toEqual([
      'tag:docs',
      'Ship itAlpha',
      'Write docsAlpha',
      'tag:release',
      'Ship itAlpha',
      'tag:',
      'Plan itAlpha',
      'Tidy upAlpha',
      'Pricing pageBravo',
      'zshAlpha',
      'Home shell~',
    ]);
    expect(within(section('Tags')).getByText('No tag')).toBeTruthy();
    expect(useUIStore.getState().sidebarGroupMode).toBe('tag');
    expect(window.api.globalSettings.set).toHaveBeenCalledWith('ui:sidebar-group', 'tag');
  });
});
