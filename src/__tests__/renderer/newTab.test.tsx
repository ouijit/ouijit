import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { PanelBar } from '../../components/terminal/PanelTabs';
import { NewTabPage } from '../../components/terminal/NewTabPanel';
import { terminalInstances } from '../../components/terminal/terminalRegistry';
import { startRunner } from '../../components/terminal/terminalActions';
import { getProjectConfig, runnerPlace, useProjectDataStore } from '../../stores/projectDataStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { useHomeChatStore } from '../../stores/homeChatStore';
import { DEFAULT_DISPLAY_STATE } from '../../stores/terminalDisplay';
import type { ProjectHooks, SandboxBackendId, SandboxProviderId, Script } from '../../types';
import { DEFAULT_TASK_OPENING } from '../../chat/preferences';

vi.mock('../../components/terminal/terminalReact', () => ({
  refreshTerminalGitStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../components/terminal/terminalActions', () => ({
  startRunner: vi.fn().mockResolvedValue(null),
}));

const PROJECT = '/tmp/project';
const PTY = 'pty-1';
let tabs = 0;
let TAB = '';
const CARD_FIELD = 'Run a script, open a file, or enter a URL';

/** The card holding the tab: what the page asks of it is what these tests read. */
const card = {
  projectPath: PROJECT,
  worktreePath: PROJECT,
  panels: [] as { id: string; kind: 'newTab' }[],
  addPlanPanel: vi.fn(),
  addWebPreviewPanel: vi.fn(),
  addNewTabPanel: vi.fn(),
  activatePanel: vi.fn(),
  closePanel: vi.fn(),
  fit: vi.fn(),
};

function seed({
  hooks = {},
  scripts = [],
  sandboxes = [],
  defaultSandbox = 'none',
}: {
  hooks?: ProjectHooks;
  scripts?: Script[];
  sandboxes?: SandboxBackendId[];
  defaultSandbox?: SandboxProviderId;
}) {
  useProjectDataStore.setState({
    configByProject: {
      [PROJECT]: {
        sandboxStatuses: [],
        availableSandboxProviders: sandboxes,
        hooks,
        defaultSandbox,
        sandboxCliAccess: 'read',
        taskOpening: DEFAULT_TASK_OPENING,
      },
    },
    scriptsByProject: { [PROJECT]: scripts },
  });
}

function openNewTab() {
  render(
    <>
      <PanelBar ptyId={PTY} />
      <NewTabPage ptyId={PTY} panelId={TAB} />
    </>,
  );
}

const field = (label = CARD_FIELD) => screen.getByLabelText(label) as HTMLInputElement;
const type = (value: string, label?: string) => fireEvent.change(field(label), { target: { value } });
const press = (key: string, label?: string) => fireEvent.keyDown(field(label), { key });
const marked = () => screen.queryAllByRole('option').filter((o) => o.getAttribute('aria-selected') === 'true');

describe('a new tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    TAB = `panel-new-${++tabs}`;
    card.panels = [{ id: TAB, kind: 'newTab' }];
    (terminalInstances as Map<string, unknown>).set(PTY, card);
    useTerminalStore.setState({
      displayStates: {
        [PTY]: {
          ...DEFAULT_DISPLAY_STATE,
          ptyId: PTY,
          projectPath: PROJECT,
          panels: [{ id: TAB, kind: 'newTab' }],
          activePanelId: TAB,
        },
      },
    });
    useHomeChatStore.setState({ currentId: '', chats: [] });
    seed({});
  });

  test('becomes the file, page or port typed into it, with nothing picked until something is typed or an arrow pressed', async () => {
    const files = ['notes/week.md', 'README.md', 'a.md', 'b.md', 'c.md', 'd.md', 'e.md'];
    vi.mocked(window.api.plan.listFiles).mockResolvedValue(
      files.map((rel, i) => ({ path: `${PROJECT}/${rel}`, modifiedAt: 100 - i })),
    );
    openNewTab();

    expect(await screen.findByText('week.md')).toBeTruthy();
    expect(screen.getByText('notes/')).toBeTruthy();
    expect(screen.queryByText('e.md')).toBeNull();
    expect(marked()).toEqual([]);
    press('Enter');
    expect(card.addPlanPanel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('2 more'));
    expect(screen.getByText('e.md')).toBeTruthy();

    press('ArrowDown');
    expect(marked().map((o) => o.textContent)).toEqual(['Configure run command…']);
    press('ArrowDown');
    press('ArrowDown');
    expect(marked().map((o) => o.textContent)).toEqual(['week.mdnotes/']);

    type('read');
    expect(screen.queryByText('week.md')).toBeNull();
    press('Enter');
    expect(card.addPlanPanel).toHaveBeenCalledWith(`${PROJECT}/README.md`, true, TAB);

    type('4321');
    expect(marked().map((o) => o.textContent)).toEqual(['Open localhost:4321']);
    press('Enter');
    expect(card.addWebPreviewPanel).toHaveBeenCalledWith('http://localhost:4321', { replacing: TAB });

    type('example.com/docs');
    fireEvent.click(screen.getByText('Open example.com/docs'));
    expect(card.addWebPreviewPanel).toHaveBeenLastCalledWith('https://example.com/docs', { replacing: TAB });

    type('nothing like it');
    expect(screen.getByText('Nothing matches')).toBeTruthy();
    press('Escape');
    expect(card.closePanel).toHaveBeenCalledWith(TAB);

    fireEvent.click(screen.getByLabelText('New tab', { selector: 'button' }));
    expect(card.activatePanel).toHaveBeenCalledWith(TAB);
    expect(card.addNewTabPanel).not.toHaveBeenCalled();
  });

  test("runs the project's commands in its place, where Run in last pointed, and saves new or edited ones", async () => {
    const lint: Script = { id: 's1', name: 'Lint', command: 'npm run lint', sortOrder: 0, restartIfRunning: false };
    seed({ scripts: [lint], sandboxes: ['custom'], defaultSandbox: 'custom' });
    openNewTab();

    fireEvent.click(screen.getByText('Configure run command…'));
    fireEvent.change(await screen.findByLabelText('Command'), { target: { value: 'npm run dev' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(startRunner).toHaveBeenCalledWith(PTY, undefined, 'custom', TAB));
    expect(window.api.hooks.save).toHaveBeenCalledWith(
      PROJECT,
      expect.objectContaining({ type: 'run', command: 'npm run dev' }),
    );

    fireEvent.click(screen.getByText('Lint'));
    await waitFor(() => expect(startRunner).toHaveBeenLastCalledWith(PTY, lint, 'custom', TAB));

    fireEvent.click(screen.getByLabelText('Run in'));
    fireEvent.click(await screen.findByRole('button', { name: 'Host' }));
    await waitFor(() => expect(runnerPlace(getProjectConfig(PROJECT))).toBe('none'));
    expect(getProjectConfig(PROJECT)?.defaultSandbox).toBe('custom');
    type('lin');
    press('Enter');
    await waitFor(() => expect(startRunner).toHaveBeenLastCalledWith(PTY, lint, undefined, TAB));

    type('');
    const runs = vi.mocked(startRunner).mock.calls.length;
    fireEvent.click(screen.getByLabelText('Edit Lint'));
    expect(await screen.findByText('Edit Script')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'npm run lint -- --fix' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() =>
      expect(window.api.scripts.save).toHaveBeenCalledWith(PROJECT, { ...lint, command: 'npm run lint -- --fix' }),
    );
    expect(startRunner).toHaveBeenCalledTimes(runs);
    await waitFor(() => expect(screen.queryByText('Edit Script')).toBeNull());
    fireEvent.click(screen.getByText('New script…'));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Test' } });
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'npm test' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() =>
      expect(startRunner).toHaveBeenLastCalledWith(
        PTY,
        expect.objectContaining({ name: 'Test', command: 'npm test' }),
        undefined,
        TAB,
      ),
    );
  });

  test("lists the card's own project's commands, loading them when only another project's are held", async () => {
    useProjectDataStore.setState({
      configByProject: {},
      scriptsByProject: {
        '/elsewhere': [{ id: 's1', name: 'Lint', command: 'npm run lint', sortOrder: 0, restartIfRunning: false }],
      },
    });
    vi.mocked(window.api.hooks.get).mockResolvedValueOnce({
      run: { id: 'h1', type: 'run', name: 'Run', command: 'npm run dev' },
    });
    vi.mocked(window.api.scripts.getAll).mockResolvedValueOnce([
      { id: 's2', name: 'Build', command: 'make', sortOrder: 0, restartIfRunning: false },
    ]);
    openNewTab();

    expect(await screen.findByText('Build')).toBeTruthy();
    expect(screen.getByText('Run')).toBeTruthy();
    expect(screen.queryByText('Lint')).toBeNull();
    expect(screen.queryByText('Configure run command…')).toBeNull();
  });

  test("in one of Chat's conversations, offers its folder's files and pages, and no scripts", async () => {
    useHomeChatStore.setState({ currentId: PTY });
    vi.mocked(window.api.plan.listFiles).mockResolvedValue([{ path: `${PROJECT}/calendar.md`, modifiedAt: 1 }]);
    openNewTab();

    const list = screen.getByRole('listbox', { name: 'New tab' });
    expect(await within(list).findByText('calendar.md')).toBeTruthy();
    expect(within(list).queryByText('Scripts')).toBeNull();
    expect(within(list).queryByText('New script…')).toBeNull();
    type('cal', 'Open a file, or enter a URL');
    press('Enter', 'Open a file, or enter a URL');
    expect(card.addPlanPanel).toHaveBeenCalledWith(`${PROJECT}/calendar.md`, true, TAB);
  });
});
