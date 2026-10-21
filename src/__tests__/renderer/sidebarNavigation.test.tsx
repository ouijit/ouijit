import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Sidebar } from '../../components/SidebarReact';
import { MainView } from '../../components/MainView';
import { TitleBar } from '../../components/TitleBarReact';
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
    tags: string[] = [];
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
    setTags(tags: string[]) {
      this.tags = tags;
      useTerminalStore.getState().updateDisplay(this.ptyId, { tags });
    }
    toggleDiffPanel() {}
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
const HOME = '/Users/test';

function task(over: Partial<TaskWithWorkspace>): TaskWithWorkspace {
  return { taskNumber: 1, name: 'Task', status: 'in_progress', order: 0, createdAt: '2026-10-01T00:00:00Z', ...over };
}

const TASKS: Record<string, TaskWithWorkspace[]> = {
  [ALPHA.path]: [
    task({ taskNumber: 8, name: 'Ship it', status: 'in_progress', order: 1, branch: 't-8', worktreePath: '/wt/8' }),
    task({ taskNumber: 9, name: 'Write docs', status: 'in_review', order: 0, branch: 't-9', worktreePath: '/wt/9' }),
    task({ taskNumber: 10, name: 'Plan it', status: 'todo', order: 0 }),
    task({ taskNumber: 11, name: 'Tidy up', status: 'in_progress', order: 0, branch: 't-11', worktreePath: '/wt/11' }),
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
  useAppStore.setState({ projects: [ALPHA, BRAVO], taskCacheByProject: { ...TASKS }, viewByProject: {} });
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
      <TitleBar />
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
    expect(screen.getByRole('banner').textContent).toContain('AlphaWrite docs');
    expect(useAppStore.getState().activeProjectPath).toBe(ALPHA.path);

    // A task with several opens the one used last, with only its own terminals behind it.
    tick(1000);
    fireEvent.click(row(projects, 'Ship it'));
    await waitFor(() => expect(front()).toBe(ship2));
    expect(cards()).toEqual([ship1, ship2].sort());
    expect(display(docs).lastViewedAt).toBe(Date.now());

    // ⌘1 counts the task's back cards; the task and both its terminals are marked.
    press('1');
    await waitFor(() => expect(front()).toBe(ship1));
    expect(within(projects).getAllByRole('button', { current: true })).toHaveLength(3);

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

    // From the board: the project's board button opens it, and its terminal rows open their terminal.
    tick(1000);
    const alpha = document.querySelector<HTMLElement>(`[data-project-path="${ALPHA.path}"]`)!;
    fireEvent.click(within(alpha).getByLabelText('Board'));
    await waitFor(() => expect(document.querySelector('.kanban-board')).toBeTruthy());
    expect(useAppStore.getState().selection).toEqual({ kind: 'page', projectPath: ALPHA.path, page: 'board' });
    expect(screen.getByRole('banner').textContent).toContain('AlphaBoard');
    expect(within(screen.getByRole('banner')).getByLabelText('New terminal')).toBeTruthy();
    act(() => useAppStore.getState().openPage(ALPHA.path, 'settings'));
    // Settings is for configuring; nothing is made from it.
    expect(within(screen.getByRole('banner')).queryByLabelText('New terminal')).toBeNull();
    expect(within(screen.getByRole('banner')).queryByLabelText('New task')).toBeNull();
    act(() => useAppStore.getState().openPage(ALPHA.path, 'board'));
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

describe('stacking several from the sidebar', () => {
  test('⌘- and shift-clicking rows in one group stacks them, and a whole project or tag stacks at once', async () => {
    const ship1 = await spawn(ALPHA.path, 8);
    const ship2 = await spawn(ALPHA.path, 8);
    const docs = await spawn(ALPHA.path, 9);
    const shell = await spawn(ALPHA.path);
    const pricing = await spawn(BRAVO.path, 3);
    render(<App />);
    const projects = () => section('Projects');
    const modClick = (title: string) => fireEvent.click(row(projects(), title), { metaKey: true, ctrlKey: true });
    const banner = () => screen.getByRole('banner').textContent;
    const marked = () => within(projects()).getAllByRole('button', { current: true }).length;

    fireEvent.click(row(projects(), 'Write docs'));
    await waitFor(() => expect(cards()).toEqual([docs]));

    // ⌘ adds a task, all its terminals, in front; the breadcrumb counts what is stacked.
    modClick('Ship it');
    await waitFor(() => expect(cards()).toEqual([docs, ship1, ship2].sort()));
    expect(front()).toBe(ship2);
    expect(banner()).toContain('2 tasks');
    expect(marked()).toBe(4);

    // ⌘ again takes it out; down to one task, the stack is that task's own.
    modClick('Write docs');
    await waitFor(() => expect(cards()).toEqual([ship1, ship2].sort()));
    expect(banner()).toContain('Ship it');
    expect(marked()).toBe(3);

    // A plain click on one of them is that one alone, down to a single terminal of a task.
    fireEvent.click(document.querySelector(`[data-sidebar-row][data-pty-id="${ship1}"]`)!);
    await waitFor(() => expect(cards()).toEqual([ship1]));

    // A stack never spans two projects: ⌘ in another starts over there.
    modClick('Pricing page');
    await waitFor(() => expect(cards()).toEqual([pricing]));

    // ⌘ on a terminal waiting for you adds it, when it is in the same project.
    fireEvent.click(row(projects(), 'Write docs'));
    await waitFor(() => expect(cards()).toEqual([docs]));
    tick(1000);
    act(() => {
      useTerminalStore.getState().updateDisplay(shell, { status: 'thinking' });
      useTerminalStore.getState().updateDisplay(shell, { status: 'ready' });
    });
    fireEvent.click(row(section('Waiting for you'), 'Shell'), { metaKey: true, ctrlKey: true });
    await waitFor(() => expect(cards()).toEqual([docs, shell].sort()));
    expect(front()).toBe(shell);
    fireEvent.click(row(section('Waiting for you'), 'Shell'));
    await waitFor(() => expect(cards()).toEqual([shell]));

    // Shift takes in every row from the last one clicked.
    fireEvent.click(row(projects(), 'Write docs'));
    await waitFor(() => expect(cards()).toEqual([docs]));
    fireEvent.click(row(projects(), 'Shell'), { shiftKey: true });
    await waitFor(() => expect(cards()).toEqual([docs, shell].sort()));
    // A task in the range with nothing open resumes into the stack, as it does clicked alone.
    fireEvent.click(row(projects(), 'Tidy up'), { shiftKey: true });
    await waitFor(() => expect(cards()).toHaveLength(5));
    expect(display(front()!)).toMatchObject({ taskId: 11, projectPath: ALPHA.path });
    expect(cards()).toEqual(expect.arrayContaining([docs, shell, ship1, ship2]));
    expect(banner()).toContain('5 terminals');

    // Right-clicking any of them offers the menu for all of them, once.
    const openMenu = async (title: string) => {
      fireEvent.contextMenu(row(projects(), title));
      return waitFor(() => {
        const open = document.querySelector<HTMLElement>('.context-menu--visible');
        if (!open) throw new Error('the menu did not open');
        return open;
      });
    };
    const submenu = async (menu: HTMLElement, heading: string, item: string) => {
      fireEvent.mouseEnter(within(menu).getByText(heading).closest('div')!);
      fireEvent.click(await within(menu).findByText(item));
      await waitFor(() => expect(document.querySelector('.context-menu')).toBeNull());
    };
    await submenu(await openMenu('Write docs'), 'Tag', 'New tag…');
    const name = await screen.findByLabelText('New tag');
    fireEvent.change(name, { target: { value: 'batch' } });
    fireEvent.keyDown(name, { key: 'Enter' });
    expect(cards().map((id) => display(id).tags)).toEqual(cards().map(() => ['batch']));
    await submenu(await openMenu('Shell'), 'Move to', 'In Review');
    await waitFor(() => expect(window.api.task.setStatus).toHaveBeenCalledTimes(3));
    expect(
      vi
        .mocked(window.api.task.setStatus)
        .mock.calls.map(([, n, status]) => [n, status])
        .sort(),
    ).toEqual([
      [11, 'in_review'],
      [8, 'in_review'],
      [9, 'in_review'],
    ]);

    // A plain click is that task alone again.
    fireEvent.click(row(projects(), 'Write docs'));
    await waitFor(() => expect(cards()).toEqual([docs]));

    // The project's menu stacks all of it, and a terminal opened there joins.
    fireEvent.click(screen.getByLabelText('More for Alpha'));
    fireEvent.click(await screen.findByText('All terminals'));
    await waitFor(() => expect(cards()).toHaveLength(5));
    expect(banner()).toContain('All terminals');
    fireEvent.contextMenu(document.querySelector(`[data-project-path="${ALPHA.path}"]`)!);
    fireEvent.click(await screen.findByText('New terminal'));
    await waitFor(() => expect(cards()).toHaveLength(6));
    // So does ⌘ on its name, which alone opens the board.
    fireEvent.click(row(projects(), 'Write docs'));
    await waitFor(() => expect(cards()).toEqual([docs]));
    const alphaHeader = document.querySelector<HTMLElement>(`[data-project-path="${ALPHA.path}"]`)!;
    fireEvent.click(within(alphaHeader).getByText('Alpha'), { metaKey: true, ctrlKey: true });
    await waitFor(() => expect(cards()).toHaveLength(6));
    expect(banner()).toContain('All terminals');

    // A tag's name stacks every terminal carrying it, from any project.
    act(() => {
      useTerminalStore.getState().updateDisplay(ship1, { tags: ['Release'] });
      useTerminalStore.getState().updateDisplay(pricing, { tags: ['release'] });
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Tags' }));
    // A task opened under a tag brings its other terminals; ⌘ there keeps only those carrying the tag.
    const release = document.querySelector<HTMLElement>('[data-group="tag:release"]')!.parentElement!;
    fireEvent.click(row(release, 'Ship it'));
    await waitFor(() => expect(cards()).toEqual([ship1, ship2].sort()));
    fireEvent.click(row(release, 'Pricing page'), { metaKey: true, ctrlKey: true });
    await waitFor(() => expect(cards()).toEqual([ship1, pricing].sort()));
    fireEvent.click(within(section('Tags')).getByText('Release'));
    await waitFor(() => expect(banner()).toContain('Release'));
    expect(cards()).toEqual([ship1, pricing].sort());

    fireEvent.contextMenu(row(section('Tags'), 'Pricing page'));
    fireEvent.click(await screen.findByText('Close 2 terminals'));
    await waitFor(() => expect(display(ship1)).toBeUndefined());
    expect(display(pricing)).toBeUndefined();
  });
});

test('⌘ on a project with nothing open resumes its active tasks into one stack, or opens its board', async () => {
  const DELTA = { path: '/code/delta', name: 'Delta' };
  useAppStore.setState({ projects: [ALPHA, BRAVO, DELTA] });
  render(<App />);
  const name = (project: { path: string; name: string }) =>
    within(document.querySelector<HTMLElement>(`[data-project-path="${project.path}"]`)!).getByText(project.name);

  fireEvent.click(name(ALPHA), { metaKey: true, ctrlKey: true });
  await waitFor(() => expect(cards()).toHaveLength(3));
  expect(
    cards()
      .map((id) => display(id).taskId)
      .sort(),
  ).toEqual([11, 8, 9]);
  expect(screen.getByRole('banner').textContent).toContain('All terminals');

  fireEvent.click(name(DELTA), { metaKey: true, ctrlKey: true });
  await waitFor(() =>
    expect(useAppStore.getState().selection).toEqual({ kind: 'page', projectPath: DELTA.path, page: 'board' }),
  );
});

test('a project opens to the board or terminals it last showed, and to its board once those have closed', async () => {
  const ship = await spawn(ALPHA.path, 8);
  const docs = await spawn(ALPHA.path, 9);
  const pricing = await spawn(BRAVO.path, 3);
  render(<App />);
  const name = (project: { path: string; name: string }) =>
    within(document.querySelector<HTMLElement>(`[data-project-path="${project.path}"]`)!).getByText(project.name);
  const board = (project: { path: string }) => ({ kind: 'page', projectPath: project.path, page: 'board' });

  fireEvent.click(row(section('Projects'), 'Write docs'));
  fireEvent.click(row(section('Projects'), 'Ship it'), { metaKey: true, ctrlKey: true });
  await waitFor(() => expect(cards()).toEqual([docs, ship].sort()));

  fireEvent.click(name(BRAVO));
  await waitFor(() => expect(useAppStore.getState().selection).toEqual(board(BRAVO)));
  fireEvent.click(name(ALPHA));
  await waitFor(() => expect(cards()).toEqual([docs, ship].sort()));
  expect(front()).toBe(ship);

  fireEvent.click(row(section('Projects'), 'Pricing page'));
  await waitFor(() => expect(cards()).toEqual([pricing]));
  fireEvent.click(name(ALPHA));
  await waitFor(() => expect(cards()).toEqual([docs, ship].sort()));
  fireEvent.click(name(BRAVO));
  await waitFor(() => expect(cards()).toEqual([pricing]));

  act(() => {
    useTerminalStore.getState().removeTerminal(docs);
    useTerminalStore.getState().removeTerminal(ship);
  });
  fireEvent.click(name(ALPHA));
  await waitFor(() => expect(useAppStore.getState().selection).toEqual(board(ALPHA)));
});

describe('creating from the sidebar', () => {
  test('a project row makes tasks and shells in that project, and a task row has the menu the board gives it', async () => {
    const ship = await spawn(ALPHA.path, 8);
    render(<App />);
    fireEvent.click(row(section('Projects'), 'Ship it'));
    await waitFor(() => expect(front()).toBe(ship));

    // A task's row has the board card's menu: Open in ▸ Terminal adds to its stack.
    fireEvent.contextMenu(row(section('Projects'), 'Ship it'));
    const menu = await waitFor(() => {
      const open = document.querySelector<HTMLElement>('.context-menu--visible');
      if (!open) throw new Error('the menu did not open');
      return open;
    });
    expect(within(menu).getByText('Move to')).toBeTruthy();
    fireEvent.mouseEnter(within(menu).getByText('Open in').closest('div')!);
    fireEvent.click(await within(menu).findByText('Terminal'));
    await waitFor(() => expect(cards()).toHaveLength(2));
    const second = front()!;
    expect(display(second)).toMatchObject({ taskId: 8, projectPath: ALPHA.path });

    // A terminal under it can be renamed in place.
    await waitFor(() => expect(document.querySelector('.context-menu')).toBeNull());
    fireEvent.contextMenu(document.querySelector(`[data-sidebar-row][data-pty-id="${second}"]`)!);
    fireEvent.click(await screen.findByText('Rename terminal'));
    const field = await within(section('Projects')).findByLabelText('Name');
    fireEvent.change(field, { target: { value: 'review' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(display(second).label).toBe('review');

    // A task in progress with nothing open stays listed, asleep, and wakes into a terminal.
    const idle = row(section('Projects'), 'Tidy up').closest<HTMLElement>('[data-sidebar-row]')!;
    expect(within(idle).getByLabelText('No terminal open')).toBeTruthy();
    expect(within(section('Projects')).queryByText('Plan it')).toBeNull();
    fireEvent.click(row(section('Projects'), 'Tidy up'));
    await waitFor(() => expect(display(front()!)).toMatchObject({ taskId: 11, projectPath: ALPHA.path }));
    const woken = row(section('Projects'), 'Tidy up').closest<HTMLElement>('[data-sidebar-row]')!;
    expect(within(woken).queryByLabelText('No terminal open')).toBeNull();

    // A project's right-click menu opens a shell there, wherever you are.
    fireEvent.contextMenu(document.querySelector(`[data-project-path="${BRAVO.path}"]`)!);
    fireEvent.click(await screen.findByText('New terminal'));
    await waitFor(() => expect(display(front()!)).toMatchObject({ taskId: null, projectPath: BRAVO.path }));

    // Its + makes a task, which for a project not on screen gets the sheet, named for where it goes.
    const alpha = document.querySelector<HTMLElement>(`[data-project-path="${ALPHA.path}"]`)!;
    fireEvent.click(within(alpha).getByLabelText('New task in Alpha'));
    const sheet = await screen.findByTestId('composer-sheet');
    fireEvent.change(sheet.querySelector('textarea')!, { target: { value: 'From the sidebar' } });

    // The sheet names its project and can be pointed at another without losing the draft.
    fireEvent.click(within(sheet).getByLabelText('Project: Alpha'));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Bravo' }));
    const moved = await screen.findByTestId('composer-sheet');
    expect(within(moved).getByLabelText('Project: Bravo')).toBeTruthy();
    expect(moved.querySelector('textarea')!.value).toBe('From the sidebar');
    fireEvent.keyDown(document, { key: 'Enter', metaKey: true, ctrlKey: true });
    await waitFor(() => expect(window.api.task.create).toHaveBeenCalledWith(BRAVO.path, 'From the sidebar', undefined));
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
      '└claude',
      '└npm test',
      'Write docs',
      'zsh',
      BRAVO.path,
      'Pricing page',
      HOME,
      'Home shell',
    ]);
    // Using a terminal moves it to the front of its stack, not in the list.
    const before = rows();
    act(() => {
      useTerminalStore.getState().activate('ship-a');
      useTerminalStore.getState().activate('docs');
    });
    expect(rows()).toEqual(before);
    expect(within(section('Projects')).getByText('~')).toBeTruthy();
    // A project with nothing going on offers the next step: start what is waiting, or make a task.
    const CHARLIE = { path: '/code/charlie', name: 'Charlie' };
    const DELTA = { path: '/code/delta', name: 'Delta' };
    act(() => {
      useAppStore.getState().updateProjectTaskCache(CHARLIE.path, [task({ taskNumber: 1, status: 'todo' })]);
      useAppStore.getState().setProjects([ALPHA, BRAVO, CHARLIE, DELTA]);
    });
    const group = (path: string) =>
      document.querySelector<HTMLElement>(`[data-project-path="${path}"]`)!.parentElement!;
    expect(within(group(CHARLIE.path)).getByText('Start a task')).toBeTruthy();
    expect(within(group(DELTA.path)).getByText('New task')).toBeTruthy();
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
    expect(within(section('Tags')).queryByText(/No tags yet/)).toBeNull();

    // With nothing tagged, the view says how to get a tag rather than going blank.
    act(() => useTerminalStore.setState(useTerminalStore.getInitialState(), true));
    expect(within(section('Tags')).getByText(/No tags yet/)).toBeTruthy();
    expect(useUIStore.getState().sidebarGroupMode).toBe('tag');
    expect(window.api.globalSettings.set).toHaveBeenCalledWith('ui:sidebar-group', 'tag');
  });
});
